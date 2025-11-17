"use client";

import useSWR from "swr";
import { JobDetailResponse } from "@/types/runs";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useJob(jobId: string) {
  const { data, error, isLoading, mutate } = useSWR<JobDetailResponse>(
    `/api/jobs/${jobId}`,
    fetcher,
    {
      refreshInterval: 3000, // Poll every 3 seconds
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  );

  return {
    job: data?.job,
    isLoading,
    isError: error,
    mutate,
  };
}

