import { DateTime } from "@/components/format/date-time";
import { Money } from "@/components/format/money";
import { FeeScheduleDialog } from "@/components/programmes/fee-schedule-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProgrammeDetail } from "@/lib/services/programmes";

// One programme on `/staff/programmes`: its modules and, for each session, the fee schedule (instalments, amounts, due
// dates) with the students already billed from it, and the actions to edit it or add another session.

export interface ProgrammeCardProps {
  programme: ProgrammeDetail;
  /** Sessions this programme has no schedule for yet and that can be added. */
  addableSessions: string[];
}

export function ProgrammeCard({ programme, addableSessions }: ProgrammeCardProps) {
  const titleId = `programme-${programme.id}`;
  return (
    <section aria-labelledby={titleId}>
      <Card>
        <CardHeader>
          <CardTitle id={titleId}>
            {programme.name}{" "}
            <span className="font-mono text-sm text-muted-foreground">{programme.code}</span>
          </CardTitle>
          <CardDescription>
            {programme.durationYears}-year programme
            {programme.modules.length > 0
              ? `, ${programme.modules.length} ${programme.modules.length === 1 ? "module" : "modules"}`
              : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Modules</h3>
            {programme.modules.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {programme.modules.map((module) => (
                  <li key={module.id}>
                    <Badge variant="outline" className="h-auto gap-1.5 py-1">
                      <span className="font-mono">{module.code}</span>
                      <span className="text-muted-foreground">{module.title}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No modules assigned to this programme.
              </p>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Fee schedules</h3>
              {addableSessions.length > 0 ? (
                <FeeScheduleDialog
                  mode="add"
                  programmeId={programme.id}
                  programmeName={programme.name}
                  sessions={addableSessions}
                />
              ) : null}
            </div>

            {programme.feeSchedules.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No fee schedule yet. Students enrolled into a session without one are not billed.
              </p>
            ) : (
              programme.feeSchedules.map((schedule) => (
                <div key={schedule.academicYear} className="space-y-2 rounded-xl border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h4 className="font-medium">Session {schedule.academicYear}</h4>
                      <p className="text-sm text-muted-foreground">
                        Total <Money value={schedule.total} /> &middot;{" "}
                        {schedule.billedStudents === 0
                          ? "no students billed yet"
                          : `${schedule.billedStudents} ${schedule.billedStudents === 1 ? "student" : "students"} billed`}
                      </p>
                    </div>
                    <FeeScheduleDialog
                      mode="edit"
                      programmeId={programme.id}
                      programmeName={programme.name}
                      schedule={schedule}
                    />
                  </div>
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <caption className="sr-only">
                        {programme.name} fee schedule for {schedule.academicYear}
                      </caption>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Instalment</TableHead>
                          <TableHead scope="col" className="text-right">
                            Amount
                          </TableHead>
                          <TableHead scope="col">Due</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {schedule.instalments.map((instalment) => (
                          <TableRow key={instalment.instalment}>
                            <TableCell>{instalment.instalment}</TableCell>
                            <TableCell className="text-right">
                              <Money value={instalment.amount} />
                            </TableCell>
                            <TableCell>
                              <DateTime value={instalment.dueDate} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
