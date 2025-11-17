# Implementation Plan: Multi-User Support & Parallel Execution

## 🎯 Goals

### Requirements
- **5 users maximum** running tasks simultaneously
- **Each user**: 1 active task at a time (can queue up to 5 tasks)
- **Each task**: 10 concurrent runs (attempts) in parallel
- **Total capacity**: 5 users × 10 runs = **50 concurrent Docker containers max**
- **Duration**: 2-day work trial (temporary deployment)

### Architecture Decisions
- **Frontend/API**: Vercel (Next.js app)
- **Worker Service**: EC2 m5.4xlarge (spot instance)
- **Database**: Neon PostgreSQL
- **Storage**: AWS S3 (or Cloudflare R2)
- **Cost Target**: ~$7-12 for 2 days

---

## 🏗️ Architecture Overview

```
┌─────────────────┐
│  Vercel         │  Next.js App (Frontend + API Routes)
│  - Frontend UI  │  - Job creation
│  - API Routes   │  - Job fetching
│  - Auth         │  - Health checks
└─────────────────┘
         │
         ├─────────────────┐
         │                 │
         ▼                 ▼
┌─────────────────┐  ┌─────────────────┐
│  Neon           │  │  S3             │
│  PostgreSQL     │  │  Object Storage │
│  - Jobs DB      │  │  - Task zips    │
│  - User data    │  │  - Harbor logs  │
└─────────────────┘  └─────────────────┘
         │
         │ (polling)
         ▼
┌─────────────────┐
│  EC2 m5.4xlarge │  Worker Service
│  - Job Queue    │  - Harbor execution
│  - Docker        │  - 50 containers
│  - Long-running │  - Background jobs
└─────────────────┘
```

### Resource Requirements (EC2)
- **Instance**: m5.4xlarge
- **vCPUs**: 16
- **RAM**: 64GB
- **Storage**: 100GB EBS volume
- **Cost (spot)**: ~$0.15-0.25/hour = **$7-12 for 48 hours**

---

## 📋 Implementation Phases

### Phase 1: Code Refactoring (Local Development)
**Goal**: Prepare code for multi-user, parallel execution

### Phase 2: Infrastructure Setup (EC2)
**Goal**: Deploy worker service to EC2

### Phase 3: Integration & Testing
**Goal**: Connect everything and validate

---

## 🎯 Mini-Milestones Breakdown

### **Phase 1: Code Refactoring**

#### **Milestone 1.1: Authentication System** (~200-250 lines)
**Goal**: Add user authentication with NextAuth.js

**Tasks**:
1. Install NextAuth.js and dependencies
2. Create auth configuration (`src/lib/auth.ts`)
3. Add users table to database schema
4. Create auth API route (`src/app/api/auth/[...nextauth]/route.ts`)
5. Create login/register pages
6. Add auth middleware
7. Protect API routes (verify user on job creation)
8. Test authentication flow locally

**Deliverables**:
- Users can register/login
- Sessions work correctly
- API routes are protected
- Jobs are linked to users (`ownerId`)

**Files to Create/Modify**:
- `frontend/src/lib/auth.ts` (new)
- `frontend/src/app/api/auth/[...nextauth]/route.ts` (new)
- `frontend/src/app/login/page.tsx` (new)
- `frontend/src/app/register/page.tsx` (new)
- `frontend/src/middleware.ts` (new)
- `frontend/src/db/schema.ts` (modify - add users, sessions, accounts tables)
- `frontend/src/app/api/jobs/route.ts` (modify - add auth check)
- `frontend/src/lib/job-service.ts` (modify - add userId)

**Commit**: `feat: add NextAuth.js authentication system`

---

#### **Milestone 1.2: User-Based Job Queue** (~200-250 lines)
**Goal**: Implement user-based job scheduling (1 active per user, 5 queued max)

**Tasks**:
1. Update `QueuedJob` interface to include `userId`
2. Modify queue to track active jobs per user (Map<userId, jobId>)
3. Implement user-based job scheduling logic
4. Add queue limits (max 5 queued jobs per user)
5. Add fair scheduling (round-robin across users)
6. Update queue status API to show per-user stats
7. Test with multiple users locally

**Deliverables**:
- Queue tracks active job per user (max 1)
- Queue limits queued jobs per user (max 5)
- Fair scheduling across users
- Queue status shows per-user information

**Files to Modify**:
- `frontend/src/lib/job-queue.ts` (major refactor)
- `frontend/src/lib/job-service.ts` (add user context)
- `frontend/src/app/api/jobs/route.ts` (get user from session)
- `frontend/src/app/api/queue/route.ts` (add per-user stats)
- `frontend/src/types/runs.ts` (add userId to QueuedJob)

**Commit**: `feat: implement user-based job queue with per-user limits`

---

#### **Milestone 1.3: Parallel Attempt Execution** (~200-250 lines)
**Goal**: Run 10 attempts concurrently per job instead of sequentially

**Tasks**:
1. Create semaphore utility (`src/lib/semaphore.ts`)
2. Refactor `job-worker.ts` to use parallel execution
3. Replace sequential `for` loop with `Promise.allSettled()` + semaphore
4. Limit to 10 concurrent attempts per job
5. Improve error handling for parallel execution
6. Track attempt progress independently
7. Test with 10 concurrent attempts locally

**Deliverables**:
- Attempts run in parallel (up to 10 concurrent)
- Semaphore limits concurrency
- Proper error handling (one failure doesn't stop others)
- All attempts complete and results stored

**Files to Create/Modify**:
- `frontend/src/lib/semaphore.ts` (new)
- `frontend/src/lib/job-worker.ts` (major refactor - parallel execution)

**Commit**: `feat: implement parallel attempt execution with 10 concurrent limit`

---

#### **Milestone 1.4: Standalone Worker Service** (~150-200 lines)
**Goal**: Create standalone worker process for EC2 deployment

**Tasks**:
1. Create `worker.ts` entry point (standalone process)
2. Create PM2 configuration (`ecosystem.config.js`)
3. Setup database polling loop
4. Handle graceful shutdown
5. Add logging and monitoring
6. Test worker runs independently (separate from Next.js)

**Deliverables**:
- Worker can run as standalone process
- Polls database for jobs
- Processes jobs correctly
- Can be managed with PM2

**Files to Create**:
- `frontend/worker.ts` (new)
- `frontend/ecosystem.config.js` (new)

**Commit**: `feat: add standalone worker service for EC2 deployment`

---

### **Phase 2: Infrastructure Setup**

#### **Milestone 2.1: EC2 Instance Setup** (~1-2 hours)
**Goal**: Launch and configure EC2 instance

**Tasks**:
1. Launch EC2 m5.4xlarge spot instance
2. Configure security groups (SSH, HTTP, HTTPS)
3. Create/download SSH key pair
4. SSH into instance
5. Update system packages
6. Install Docker
7. Install Node.js 20
8. Install Python 3.12
9. Install PM2
10. Verify all installations

**Deliverables**:
- EC2 instance running
- All dependencies installed
- Docker working
- Can SSH and run commands

**Commands**:
```bash
# Launch instance via AWS Console
# Then SSH in:
ssh -i key.pem ubuntu@<ip>

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Python
sudo apt-get install -y python3.12 python3.12-venv

# Install PM2
sudo npm install -g pm2
```

**Documentation**: Update `SETUP.md` with EC2 setup instructions

---

#### **Milestone 2.2: Deploy Worker to EC2** (~1 hour)
**Goal**: Deploy worker service and configure it to run

**Tasks**:
1. Clone repository on EC2
2. Install npm dependencies
3. Create `.env` file with production variables
4. Run database migrations
5. Build application
6. Install Harbor on EC2
7. Start worker with PM2
8. Configure PM2 auto-restart
9. Test worker can connect to database
10. Test worker can access S3

**Deliverables**:
- Worker service running on EC2
- PM2 managing the process
- Worker can poll database
- Harbor installed and working

**Commands**:
```bash
# On EC2
git clone <repo-url>
cd terminal-bench-platform/frontend
npm install

# Create .env
nano .env
# Add: DATABASE_URL, S3_*, etc.

npm run db:migrate
npm run build

# Install Harbor
cd ../harbor
pip3 install -e .

# Start worker
cd ../frontend
pm2 start worker.js --name "terminal-bench-worker"
pm2 save
pm2 startup
```

**Documentation**: Update `SETUP.md` with deployment steps

---

#### **Milestone 2.3: Vercel Deployment** (~30 min)
**Goal**: Deploy Next.js app to Vercel with production config

**Tasks**:
1. Connect GitHub repo to Vercel
2. Configure environment variables on Vercel
3. Deploy application
4. Verify deployment works
5. Test API routes
6. Test authentication

**Deliverables**:
- Next.js app deployed to Vercel
- Environment variables configured
- App accessible via Vercel URL
- Authentication works

**Documentation**: Update `README.md` with Vercel deployment info

---

### **Phase 3: Integration & Testing**

#### **Milestone 3.1: End-to-End Integration** (~2-3 hours)
**Goal**: Connect all services and verify communication

**Tasks**:
1. Verify Vercel → Neon connection
2. Verify EC2 → Neon connection
3. Verify both can access S3
4. Test job creation from Vercel
5. Verify EC2 worker picks up job
6. Verify job processing works
7. Verify results appear in UI
8. Fix any connection issues

**Deliverables**:
- All services connected
- Jobs flow: Vercel → DB → EC2 → DB → Vercel
- End-to-end test passes

**Testing Checklist**:
- [ ] Create user account
- [ ] Upload task zip
- [ ] Job appears in database
- [ ] EC2 worker processes job
- [ ] Results appear in UI
- [ ] Download buttons work

---

#### **Milestone 3.2: Multi-User Testing** (~2-3 hours)
**Goal**: Test with multiple users simultaneously

**Tasks**:
1. Create 5 test user accounts
2. Each user uploads a task
3. Verify queue limits work (1 active per user)
4. Verify fair scheduling
5. Verify no interference between users
6. Test queue limits (5 queued per user)
7. Monitor database and logs

**Deliverables**:
- 5 users can run simultaneously
- Queue limits enforced correctly
- No user interference
- Fair scheduling works

**Testing Checklist**:
- [ ] 5 users can create jobs
- [ ] Only 1 active job per user
- [ ] Up to 5 queued jobs per user
- [ ] Fair scheduling across users
- [ ] Jobs complete successfully

---

#### **Milestone 3.3: Parallel Attempts Testing** (~2-3 hours)
**Goal**: Verify 10 concurrent attempts work correctly

**Tasks**:
1. Create job with 10 runs
2. Verify 10 attempts start concurrently
3. Monitor Docker containers (should see 10 running)
4. Verify all attempts complete
5. Verify results stored correctly
6. Test error handling (if one fails)
7. Monitor EC2 resources (CPU, RAM)

**Deliverables**:
- 10 attempts run concurrently
- All complete successfully
- Resource usage acceptable
- Error handling works

**Testing Checklist**:
- [ ] 10 attempts start simultaneously
- [ ] 10 Docker containers running
- [ ] All attempts complete
- [ ] Results stored in database
- [ ] CPU/RAM usage acceptable
- [ ] No resource exhaustion

---

#### **Milestone 3.4: Stress Testing** (~3-4 hours)
**Goal**: Test full capacity (5 users × 10 attempts = 50 containers)

**Tasks**:
1. Setup monitoring (CloudWatch or basic monitoring)
2. Create 5 users, each with 1 active job (10 runs each)
3. Verify 50 Docker containers can run
4. Monitor EC2 resources continuously
5. Check for bottlenecks
6. Verify all jobs complete
7. Document performance metrics
8. Optimize if needed

**Deliverables**:
- Full capacity tested (50 containers)
- Performance metrics documented
- Any bottlenecks identified
- System stable under load

**Testing Checklist**:
- [ ] 5 users × 10 attempts = 50 containers
- [ ] All containers run successfully
- [ ] CPU usage acceptable (<80%)
- [ ] RAM usage acceptable (<80%)
- [ ] No Docker daemon issues
- [ ] All jobs complete
- [ ] Results accurate

---

## 📊 Progress Tracking

### Phase 1: Code Refactoring
- [ ] Milestone 1.1: Authentication System
- [ ] Milestone 1.2: User-Based Job Queue
- [ ] Milestone 1.3: Parallel Attempt Execution
- [ ] Milestone 1.4: Standalone Worker Service

### Phase 2: Infrastructure Setup
- [ ] Milestone 2.1: EC2 Instance Setup
- [ ] Milestone 2.2: Deploy Worker to EC2
- [ ] Milestone 2.3: Vercel Deployment

### Phase 3: Integration & Testing
- [ ] Milestone 3.1: End-to-End Integration
- [ ] Milestone 3.2: Multi-User Testing
- [ ] Milestone 3.3: Parallel Attempts Testing
- [ ] Milestone 3.4: Stress Testing

---

## 🔧 Technical Details

### Database Schema Changes
- Add `users` table (id, email, name, createdAt, updatedAt)
- Add `sessions` table (for NextAuth)
- Add `accounts` table (for NextAuth OAuth)
- Update `jobs.ownerId` to reference `users.id`

### Environment Variables Needed

**Vercel**:
- `DATABASE_URL` (Neon)
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- `OPENAI_API_KEY` (optional)

**EC2 Worker**:
- `DATABASE_URL` (Neon)
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `OPENAI_API_KEY` (optional)
- `NODE_ENV=production`
- `MAX_CONCURRENT_JOBS=5`
- `MAX_CONCURRENT_ATTEMPTS_PER_JOB=10`
- `MAX_QUEUED_JOBS_PER_USER=5`

### Key Code Patterns

**User-Based Queue**:
```typescript
// Track active jobs per user
private activeJobsByUser = new Map<string, string>(); // userId -> jobId
private queuedJobsByUser = new Map<string, QueuedJob[]>(); // userId -> jobs[]

// Enqueue with user check
if (activeJobsByUser.has(userId)) {
  // Add to user's queue (max 5)
} else {
  // Start immediately
}
```

**Parallel Attempts**:
```typescript
// Use semaphore to limit concurrency
const semaphore = new Semaphore(10); // Max 10 concurrent

const attemptPromises = Array.from({ length: runsRequested }, (_, i) =>
  semaphore.acquire().then(() => 
    runAttempt(i).finally(() => semaphore.release())
  )
);

await Promise.allSettled(attemptPromises);
```

---

## 💰 Cost Summary

### For 2-Day Trial
- **Vercel**: $0 (free tier)
- **Neon**: $0 (free tier) or $19 (paid)
- **S3**: ~$0.60
- **EC2 Spot (m5.4xlarge)**: ~$7-12
- **Total**: ~$7-12 (or ~$26-31 with paid Neon)

---

## 🚀 Next Steps

1. **Start with Milestone 1.1**: Authentication System
2. Work through Phase 1 milestones sequentially
3. Then move to Phase 2 (Infrastructure)
4. Finally Phase 3 (Testing)

Each milestone should be:
- **200-250 lines of code** (or equivalent complexity)
- **Tested locally** before moving to next
- **Committed** after completion
- **Documented** if needed

---

## 📝 Notes

- All code changes should be tested locally first
- EC2 setup can be done in parallel with code development
- Use feature flags if needed to test incrementally
- Monitor costs during testing
- Keep EC2 instance stopped when not testing to save money

---

## 🔗 Related Documents

- `README.md` - Project overview
- `SETUP.md` - Setup instructions
- `GOAL1_ANALYSIS.md` - Harbor execution analysis
- This document - Implementation plan

---

**Last Updated**: 2025-01-17
**Status**: Planning Phase
**Next Milestone**: 1.1 - Authentication System

