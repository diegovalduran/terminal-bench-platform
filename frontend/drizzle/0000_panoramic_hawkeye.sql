CREATE TABLE IF NOT EXISTS "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"status" varchar(32) NOT NULL,
	"tests_passed" integer DEFAULT 0 NOT NULL,
	"tests_total" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"reward_summary" jsonb,
	"log_path" text,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"index" integer NOT NULL,
	"state_analysis" text NOT NULL,
	"explanation" text NOT NULL,
	"commands" jsonb,
	"duration_ms" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_name" varchar(256) NOT NULL,
	"status" varchar(32) NOT NULL,
	"runs_requested" integer NOT NULL,
	"runs_completed" integer DEFAULT 0 NOT NULL,
	"zip_object_url" text,
	"owner_id" uuid,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'attempts_job_id_jobs_id_fk'
    ) THEN
        ALTER TABLE "attempts" ADD CONSTRAINT "attempts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;
--> statement-breakpoint
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'episodes_attempt_id_attempts_id_fk'
    ) THEN
        ALTER TABLE "episodes" ADD CONSTRAINT "episodes_attempt_id_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id") ON DELETE cascade ON UPDATE no action;
    END IF;
END $$;