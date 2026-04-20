import { randomUUID } from 'node:crypto';
import type { AgentForgeDB, Campaign, Cycle, Task, Screenshot } from '../storage/database.js';

export interface CreateTaskInput {
  role: 'dev' | 'test';
  title: string;
  description?: string;
  acceptance?: string[];
  e2eScenarios?: string[];
}

export interface CompleteTaskInput {
  result: string;
  docAuditToken?: string;
}

export interface CompleteCycleInput {
  passRate?: number;
  failedTests?: string[];
  screenshots?: Screenshot[];
}

export interface BugInput {
  title: string;
  description?: string;
  expected?: string;
  actual?: string;
  screenshotDescription?: string;
}

export class WorkflowEngine {
  constructor(private readonly db: AgentForgeDB) {}

  initWorkflow(projectPath: string, title: string, brief?: string): Campaign {
    const now = new Date().toISOString();
    const campaign: Campaign = {
      id: randomUUID(),
      projectPath,
      title,
      brief,
      status: 'active',
      startedAt: now,
    };
    this.db.insertCampaign(campaign);

    const cycle = this.createCycle(campaign.id, 1);
    this.db.updateCycle(cycle.id, { status: 'product', startedAt: now });

    return campaign;
  }

  private createCycle(campaignId: string, cycleNum: number): Cycle {
    const cycle: Cycle = {
      id: randomUUID(),
      campaignId,
      cycleNum,
      status: 'pending',
    };
    this.db.insertCycle(cycle);
    return cycle;
  }

  getCycleState(cycleId?: string, campaignId?: string): { cycle: Cycle; tasks: Task[] } | null {
    let cycle: Cycle | undefined;

    if (cycleId) {
      cycle = this.db.getCycle(cycleId);
    } else if (campaignId) {
      cycle = this.db.getActiveCycle(campaignId);
    }

    if (!cycle) return null;
    const tasks = this.db.listTasks(cycle.id);
    return { cycle, tasks };
  }

  createTasks(cycleId: string, taskInputs: CreateTaskInput[]): Task[] {
    const cycle = this.db.getCycle(cycleId);
    if (!cycle) throw new Error(`Cycle not found: ${cycleId}`);
    if (cycle.status !== 'product') {
      throw new Error(`Cannot create tasks in cycle status "${cycle.status}" — must be "product"`);
    }

    const now = new Date().toISOString();
    const tasks: Task[] = [];

    for (const input of taskInputs) {
      const task: Task = {
        id: randomUUID(),
        cycleId,
        role: input.role,
        title: input.title,
        description: input.description,
        acceptance: input.acceptance,
        e2eScenarios: input.e2eScenarios,
        status: 'pending',
        createdAt: now,
      };
      this.db.insertTask(task);
      tasks.push(task);
    }

    // Advance cycle to dev phase after product creates tasks
    this.db.updateCycle(cycleId, { status: 'dev' });
    return tasks;
  }

  getTasksForRole(cycleId: string, role: 'dev' | 'test'): Task[] {
    const cycle = this.db.getCycle(cycleId);
    if (!cycle) throw new Error(`Cycle not found: ${cycleId}`);
    return this.db.listTasks(cycleId, role);
  }

  completeTask(taskId: string, input: CompleteTaskInput): Task {
    const task = this.db.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    if (task.role === 'dev' && !input.docAuditToken) {
      throw new Error('Developer tasks require a docAuditToken from update_doc_first()');
    }

    if (input.docAuditToken) {
      const audit = this.db.getDocAudit(input.docAuditToken);
      if (!audit) throw new Error(`Invalid docAuditToken: ${input.docAuditToken}`);
    }

    const now = new Date().toISOString();
    this.db.updateTask(taskId, {
      status: 'completed',
      result: input.result,
      docAuditToken: input.docAuditToken,
      completedAt: now,
    });

    // Check if all dev tasks complete → advance to test phase
    const cycle = this.db.getCycle(task.cycleId)!;
    if (cycle.status === 'dev') {
      const remaining = this.db.listTasks(task.cycleId, 'dev').filter((t) => t.id !== taskId && t.status !== 'completed');
      if (remaining.length === 0) {
        this.db.updateCycle(cycle.id, { status: 'test' });
      }
    }

    return this.db.getTask(taskId)!;
  }

  addTaskComment(taskId: string, comment: string): Task {
    const task = this.db.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const comments = [...(task.comments ?? []), comment];
    this.db.updateTask(taskId, { comments });
    return this.db.getTask(taskId)!;
  }

  createBugTasks(cycleId: string, bugs: BugInput[]): Task[] {
    const cycle = this.db.getCycle(cycleId);
    if (!cycle) throw new Error(`Cycle not found: ${cycleId}`);

    const now = new Date().toISOString();
    const tasks: Task[] = [];

    for (const bug of bugs) {
      const description = [
        bug.description,
        bug.expected ? `Expected: ${bug.expected}` : null,
        bug.actual ? `Actual: ${bug.actual}` : null,
        bug.screenshotDescription ? `Screenshot: ${bug.screenshotDescription}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const task: Task = {
        id: randomUUID(),
        cycleId,
        role: 'dev',
        title: `[BUG] ${bug.title}`,
        description: description || undefined,
        acceptance: bug.expected ? [`${bug.expected}`] : undefined,
        status: 'pending',
        createdAt: now,
      };
      this.db.insertTask(task);
      tasks.push(task);
    }

    // Revert cycle to dev phase for bug fixes
    this.db.updateCycle(cycleId, { status: 'dev' });
    return tasks;
  }

  addProductFeedback(cycleId: string, feedback: string): void {
    const cycle = this.db.getCycle(cycleId);
    if (!cycle) throw new Error(`Cycle not found: ${cycleId}`);
    const existing = cycle.productBrief ?? '';
    this.db.updateCycle(cycleId, {
      productBrief: existing
        ? `${existing}\n\n## Test Feedback\n${feedback}`
        : `## Test Feedback\n${feedback}`,
    });
  }

  completeCycle(cycleId: string, input: CompleteCycleInput): Cycle {
    const cycle = this.db.getCycle(cycleId);
    if (!cycle) throw new Error(`Cycle not found: ${cycleId}`);

    if (cycle.status !== 'test') {
      throw new Error(`Cannot complete cycle in status "${cycle.status}" — must be "test"`);
    }

    const now = new Date().toISOString();
    const screenshots = input.screenshots ?? [];

    this.db.updateCycle(cycleId, {
      status: 'completed',
      screenshots,
      completedAt: now,
    });

    // Auto-start next cycle
    const campaign = this.db.getCampaign(cycle.campaignId)!;
    if (campaign.status === 'active') {
      const nextCycle = this.createCycle(campaign.id, cycle.cycleNum + 1);
      this.db.updateCycle(nextCycle.id, { status: 'product', startedAt: now });
    }

    return this.db.getCycle(cycleId)!;
  }

  captureScreenshot(cycleId: string, filePath: string, description: string): void {
    const cycle = this.db.getCycle(cycleId);
    if (!cycle) throw new Error(`Cycle not found: ${cycleId}`);

    const screenshots: Screenshot[] = [
      ...(cycle.screenshots ?? []),
      { filePath, description, capturedAt: new Date().toISOString() },
    ];
    this.db.updateCycle(cycleId, { screenshots });
  }
}
