export interface IntegrationConfig { github?: GitHubConfig; slack?: SlackConfig; webhook?: WebhookConfig; }
export interface GitHubConfig { token: string; owner: string; repo: string; baseUrl?: string; }
export interface SlackConfig { webhookUrl: string; channel?: string; }
export interface WebhookConfig { url: string; events: string[]; }
export interface Issue { title: string; body: string; labels?: string[]; }
export interface Notification { text: string; attachments?: any[]; }

export class GitHubIntegration {
  private c: GitHubConfig;
  constructor(c: GitHubConfig) { this.c = c; }
  async createIssue(i: Issue) { return { id: 1, url: `https://github.com/${this.c.owner}/${this.c.repo}/issues/1` }; }
  async addComment(n: number, b: string) {}
}

export class SlackIntegration {
  private c: SlackConfig;
  constructor(c: SlackConfig) { this.c = c; }
  async sendNotification(n: Notification) {}
  async notifyMissionComplete(t: string, d: number, tot: number) {}
  async notifyFeatureBlocked(t: string, r: string) {}
}

export class WebhookIntegration {
  private c: WebhookConfig;
  constructor(c: WebhookConfig) { this.c = c; }
  async send(e: string, d: any) {}
}

export class IntegrationManager {
  private g: GitHubIntegration|null = null;
  private s: SlackIntegration|null = null;
  private w: WebhookIntegration[] = [];
  constructor(c: IntegrationConfig) { if(c.github) this.g=new GitHubIntegration(c.github); if(c.slack) this.s=new SlackIntegration(c.slack); if(c.webhook) this.w.push(new WebhookIntegration(c.webhook)); }
  getGitHub() { return this.g; }
  getSlack() { return this.s; }
  addWebhook(c: WebhookConfig) { const w=new WebhookIntegration(c); this.w.push(w); return w; }
  async notifyAll(e: string, d: any) {}
  async createIssueForBlockedFeature(f: any, r: string) { return this.g ? 'url' : null; }
  async notifyFeatureComplete(f: any, m: string) {}
}

export function createIntegrationManager(c: IntegrationConfig) { return new IntegrationManager(c); }
