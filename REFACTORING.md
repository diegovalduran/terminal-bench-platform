# Code Refactoring: Worker Separation

## Overview

The codebase has been refactored to separate the worker service from the frontend application, improving code organization and deployment clarity.

## New Structure

```
terminal-bench-platform/
├── frontend/              # Next.js application (deployed to Vercel)
│   ├── src/
│   │   ├── app/          # Next.js routes and pages
│   │   ├── components/   # React components
│   │   ├── lib/          # Frontend-specific utilities
│   │   │   ├── job-queue.ts      # Re-exports from shared
│   │   │   ├── job-worker.ts     # Re-exports from shared
│   │   │   └── semaphore.ts      # Re-exports from shared
│   │   └── types/
│   │       └── runs.ts           # Re-exports from shared
│   └── package.json
│
├── worker/                # Standalone worker service (deployed to EC2)
│   ├── src/
│   │   └── worker.ts     # Entry point
│   ├── ecosystem.config.js
│   ├── package.json
│   └── tsconfig.json
│
└── shared/                # Shared code between frontend and worker
    ├── types/
    │   └── runs.ts       # Shared TypeScript types
    ├── lib/              # Shared utilities
    │   ├── job-queue.ts
    │   ├── job-worker.ts
    │   ├── semaphore.ts
    │   ├── job-service.ts
    │   ├── attempt-service.ts
    │   ├── s3-service.ts
    │   ├── retry.ts
    │   ├── logger.ts
    │   ├── env-validation.ts
    │   └── startup-validation.ts
    └── db/                # Shared database code
        ├── schema.ts
        └── client.ts
```

## Key Changes

### 1. Shared Code
- All shared types, utilities, and database code moved to `shared/`
- Both frontend and worker import from `shared/` using relative paths
- Frontend uses TypeScript path alias `@shared/*` for cleaner imports

### 2. Worker Service
- Standalone `worker/` directory with its own `package.json`
- Worker entry point: `worker/src/worker.ts`
- PM2 configuration: `worker/ecosystem.config.js`
- Independent TypeScript configuration

### 3. Frontend
- Re-exports shared code for backward compatibility
- Uses `@shared/*` path alias to import from shared directory
- All existing imports continue to work

## Import Patterns

### Worker
```typescript
import { QueuedJob } from "../../shared/types/runs.js";
import { jobQueue } from "../../shared/lib/job-queue.js";
```

### Frontend
```typescript
import { QueuedJob } from "@/types/runs";  // Re-exports from shared
import { jobQueue } from "@/lib/job-queue"; // Re-exports from shared
```

## Deployment

### Frontend (Vercel)
- Deploys from `frontend/` directory
- Uses Next.js build process
- No changes to deployment process

### Worker (EC2)
- Deploys from `worker/` directory
- Runs independently with PM2
- Requires separate environment variables

## Benefits

1. **Clear Separation**: Worker and frontend are clearly separated
2. **Independent Deployment**: Can deploy worker and frontend separately
3. **Shared Code**: Single source of truth for shared utilities
4. **Better Organization**: Easier to understand and maintain
5. **Scalability**: Easy to add more worker instances or services

## Migration Notes

- All existing imports continue to work (via re-exports)
- No breaking changes to API or functionality
- Worker can now be developed and deployed independently

