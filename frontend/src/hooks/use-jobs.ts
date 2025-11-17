"use client";

import useSWR from "swr";
import { JobListResponse } from "@/types/runs";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useJobs() {
  const { data, error, isLoading, mutate } = useSWR<JobListResponse>(
    "/api/jobs",
    fetcher,
    {
      refreshInterval: 5000, // Poll every 5 seconds
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    }
  );

  return {
    jobs: data?.jobs ?? [],
    isLoading,
    isError: error,
    mutate,
  };
}

