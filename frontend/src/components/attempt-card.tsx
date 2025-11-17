import { Attempt } from "@/types/runs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistance } from "date-fns";

const attemptStatusColor: Record<Attempt["status"], string> = {
  queued: "bg-zinc-100 text-zinc-700",
  running: "bg-blue-100 text-blue-800",
  success: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

interface AttemptCardProps {
  attempt: Attempt;
}

export function AttemptCard({ attempt }: AttemptCardProps) {
  const duration =
    attempt.startedAt && attempt.finishedAt
      ? formatDistance(
          new Date(attempt.finishedAt),
          new Date(attempt.startedAt),
          { includeSeconds: true }
        )
      : "—";

  const passRate = `${attempt.testsPassed}/${attempt.testsTotal}`;

  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader className="flex flex-col gap-2 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">
            Attempt {attempt.index + 1}
          </p>
          <CardTitle className="text-xl">Tests {passRate} passed</CardTitle>
          <p className="text-sm text-zinc-500">Duration: {duration}</p>
        </div>
        <Badge
          className={`capitalize ${attemptStatusColor[attempt.status]} hover:${attemptStatusColor[attempt.status]}`}
        >
          {attempt.status}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-zinc-600">
          <p className="font-medium text-zinc-800">Reward summary</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {attempt.rewardSummary ? (
              Object.entries(attempt.rewardSummary).map(([key, value]) => (
                <span
                  key={key}
                  className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium capitalize text-zinc-600"
                >
                  {key.replace(/_/g, " ")}: {value}
                </span>
              ))
            ) : (
              <span className="text-zinc-400">No rewards recorded</span>
            )}
          </div>
        </div>
        <Separator />
        <Accordion type="single" collapsible>
          {attempt.episodes.map((episode) => (
            <AccordionItem key={episode.id} value={episode.id}>
              <AccordionTrigger>
                <div className="text-left">
                  <p className="text-sm font-semibold text-zinc-900">
                    Episode {episode.index + 1}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {episode.stateAnalysis.slice(0, 96)}…
                  </p>
                </div>
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    State Analysis
                  </p>
                  <p className="text-sm text-zinc-700">{episode.stateAnalysis}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    Explanation
                  </p>
                  <p className="text-sm text-zinc-700">{episode.explanation}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    Commands
                  </p>
                  <ScrollArea className="mt-2 max-h-48 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                    <div className="space-y-3 text-sm font-mono text-zinc-800">
                      {episode.commands.map((command, idx) => (
                        <div key={`${episode.id}-cmd-${idx}`} className="space-y-1">
                          <p className="text-zinc-500">$ {command.command}</p>
                          <pre className="whitespace-pre-wrap text-zinc-900">
                            {command.output}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

