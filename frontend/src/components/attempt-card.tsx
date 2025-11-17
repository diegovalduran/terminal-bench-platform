import { Attempt } from "@/types/runs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDistance } from "date-fns";
import { CheckCircle2, XCircle } from "lucide-react";

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
        {/* Test Results Section - Collapsible */}
        <Accordion type="single" collapsible>
          <AccordionItem value="test-results" className="border-none">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex w-full items-center justify-between pr-4">
                <p className="text-sm font-semibold text-zinc-800">
                  Attempt Test Case Pass Rate
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    (from parser results)
                  </span>
                </p>
                <Badge
                  variant="outline"
                  className="bg-zinc-50 text-sm font-semibold text-zinc-700"
                >
                  {passRate} passed
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-3">
              <div className="space-y-2">
                {attempt.rewardSummary && Object.keys(attempt.rewardSummary).length > 0 ? (
                  Object.entries(attempt.rewardSummary).map(([testName, passed]) => (
                    <div
                      key={testName}
                      className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 transition-colors hover:bg-zinc-50"
                    >
                      <span className="flex-1 font-mono text-sm font-medium text-zinc-800">
                        {testName}
                      </span>
                      {passed === 1 ? (
                        <div className="flex items-center gap-2 text-emerald-600">
                          <CheckCircle2 className="h-5 w-5" />
                          <span className="text-sm font-semibold">Passed</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-rose-600">
                          <XCircle className="h-5 w-5" />
                          <span className="text-sm font-semibold">Failed</span>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-zinc-400">No test results available</p>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <Separator />

        {/* Episodes Section */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <p className="text-sm font-semibold text-zinc-800">Episodes</p>
            <Badge
              variant="secondary"
              className="bg-zinc-100 text-zinc-700 hover:bg-zinc-100"
            >
              {attempt.episodes.length}
            </Badge>
          </div>
          <Accordion type="single" collapsible>
            {attempt.episodes.map((episode) => (
              <AccordionItem key={episode.id} value={episode.id}>
                <AccordionTrigger>
                  <div className="text-left">
                    <p className="text-sm font-semibold text-zinc-900">
                      Episode {episode.index}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {episode.stateAnalysis.slice(0, 80)}…
                    </p>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pt-2">
                  {/* State Analysis Container */}
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-blue-900">
                      State Analysis:
                    </p>
                    <p className="text-sm leading-relaxed text-blue-950">
                      {episode.stateAnalysis}
                    </p>
                  </div>

                  {/* Explanation Container */}
                  <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-purple-900">
                      Explanation:
                    </p>
                    <p className="text-sm leading-relaxed text-purple-950">
                      {episode.explanation}
                    </p>
                  </div>

                  {/* Commands Section */}
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-700">
                      Commands:
                    </p>
                    <div className="h-[576px] w-full overflow-y-auto rounded-lg border border-zinc-300 bg-zinc-900">
                      <div className="space-y-4 p-4 font-mono text-sm">
                        {episode.commands.map((command, idx) => (
                          <div key={`${episode.id}-cmd-${idx}`} className="space-y-2">
                            <p className="whitespace-pre-wrap break-words text-emerald-400">$ {command.command}</p>
                            <pre className="whitespace-pre-wrap break-words text-zinc-100">
                              {command.output}
                            </pre>
                            {idx < episode.commands.length - 1 && (
                              <Separator className="bg-zinc-700" />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </CardContent>
    </Card>
  );
}

