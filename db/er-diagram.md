# ER diagram

> **Status: draft.** Assumes the proposed answers in [decisions.md](decisions.md) (DB-009 to DB-014).
> Update this diagram whenever `schema.prisma` changes; the schema is the source of truth once it exists.

A rendered export is in [er-diagram.png](er-diagram.png); re-export it when the diagram changes.

Notation: `||` exactly one, `|o` zero or one, `o{` zero or more, `|{` one or more.
`PK` primary key, `FK` foreign key, `UK` unique.

```mermaid
erDiagram
  PROGRAMME ||--o{ PROGRAMME_FEE : "priced by"
  PROGRAMME ||--o{ STUDENT : enrols
  PROGRAMME ||--o{ PROGRAMME_MODULE : includes
  MODULE ||--o{ PROGRAMME_MODULE : "taught in"
  MODULE ||--o{ ASSESSMENT : has
  STUDENT ||--o{ STATUS_CHANGE : "status history"
  STUDENT ||--o{ FEE_CHARGE : owes
  PROGRAMME_FEE |o--o{ FEE_CHARGE : "copied into"
  STUDENT ||--o{ PAYMENT : pays
  STUDENT ||--o{ SUBMISSION : makes
  ASSESSMENT ||--o{ SUBMISSION : receives
  SUBMISSION ||--|{ SUBMISSION_FILE : versions
  STUDENT ||--o{ MARK : receives
  ASSESSMENT ||--o{ MARK : "graded in"
  MARK ||--o{ MARK_CHANGE : "audit trail"
  ASSESSMENT ||--o{ EXTENSION : allows
  STUDENT ||--o{ EXTENSION : granted
  STAFF ||--o{ PAYMENT : records
  STAFF ||--o{ MARK : enters
  STAFF ||--o{ STATUS_CHANGE : makes
  STAFF ||--o{ ASSESSMENT : creates

  PROGRAMME {
    uuid id PK
    string code UK "e.g. BSC-COMP"
    string name
    int durationYears
  }
  PROGRAMME_FEE {
    uuid id PK
    uuid programmeId FK
    string academicYear "2026/27; unique with programmeId"
    decimal amount "numeric(12,2)"
    date dueDate
  }
  MODULE {
    uuid id PK
    string code UK "e.g. CS101"
    string title
  }
  PROGRAMME_MODULE {
    uuid programmeId PK, FK
    uuid moduleId PK, FK
  }
  STUDENT {
    uuid id PK
    string studentNumber UK "SMS-2026-0001"
    string fullName
    string email UK "case-insensitive"
    date dateOfBirth
    uuid programmeId FK
    string academicYear "session, e.g. 2026/27"
    int yearOfStudy "1, 2, 3"
    enum status "ENROLLED, DEFERRED, WITHDRAWN, COMPLETED"
    timestamptz createdAt
    timestamptz updatedAt
  }
  STUDENT_ID_SEQUENCE {
    int year PK
    int lastValue "incremented in a transaction"
  }
  STATUS_CHANGE {
    uuid id PK
    uuid studentId FK
    enum fromStatus "null on creation"
    enum toStatus
    string reason
    uuid changedById FK
    timestamptz changedAt
  }
  STAFF {
    uuid id PK
    string fullName
    string email UK
  }
  FEE_CHARGE {
    uuid id PK
    uuid studentId FK
    uuid programmeFeeId FK "nullable for manual adjustments"
    string academicYear
    string description "e.g. Tuition 2026/27, instalment 1"
    decimal amount "copied, not linked"
    date dueDate
    timestamptz createdAt
  }
  PAYMENT {
    uuid id PK
    uuid studentId FK
    decimal amount "> 0"
    date paidAt
    string reference UK
    uuid recordedById FK
    timestamptz recordedAt
    timestamptz voidedAt "never deleted, only voided"
    string voidReason
  }
  ASSESSMENT {
    uuid id PK
    uuid moduleId FK
    string title
    timestamptz deadline
    timestamptz closedAt "no uploads at all after this"
    uuid createdById FK
  }
  EXTENSION {
    uuid id PK
    uuid assessmentId FK "unique with studentId"
    uuid studentId FK
    timestamptz newDeadline
    string reason
  }
  SUBMISSION {
    uuid id PK
    uuid assessmentId FK "unique with studentId"
    uuid studentId FK
    timestamptz firstSubmittedAt
    timestamptz lastSubmittedAt
  }
  SUBMISSION_FILE {
    uuid id PK
    uuid submissionId FK
    string objectKey UK "S3 key, server-generated"
    string originalName
    string mimeType "PDF or DOCX"
    int sizeBytes
    timestamptz uploadedAt
  }
  MARK {
    uuid id PK
    uuid assessmentId FK "unique with studentId"
    uuid studentId FK
    decimal mark "0-100, numeric(5,2)"
    enum releaseStatus "DRAFT, PUBLISHED, WITHHELD"
    string withheldReason
    timestamptz publishedAt
    uuid enteredById FK
    timestamptz updatedAt
  }
  MARK_CHANGE {
    uuid id PK
    uuid markId FK
    decimal oldMark
    decimal newMark
    string reason "required once published"
    uuid changedById FK
    timestamptz changedAt
  }
```

## Notes

- `EXTENSION` is a stretch goal (DB-014).
- `STUDENT_ID_SEQUENCE` stands alone; it only issues Student IDs (DB-004).
- `MARK` and `SUBMISSION` are not linked directly. Both are keyed on (assessment, student), so a mark can exist
  without a submission, e.g. 0 for work that was never handed in.
- Values such as balance, overdue, late and classification are calculated, not stored — see [README.md](README.md).
