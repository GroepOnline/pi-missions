import { describe, it, expect, vi } from 'vitest';
import { IntegrationManager, GitHubIntegration, SlackIntegration, WebhookIntegration, createIntegrationManager } from '../src/integrations/index.js';

describe('Integrations', () => {
  describe('GitHubIntegration', () => {
    it('should create instance', () => {
      const g = new GitHubIntegration({ token: 't', owner: 'o', repo: 'r' });
      expect(g).toBeDefined();
    });
    it('should create issue', async () => {
      const g = new GitHubIntegration({ token: 't', owner: 'o', repo: 'r' });
      const r = await g.createIssue({ title: 'Test', body: 'Body' });
      expect(r.id).toBeDefined();
      expect(r.url).toContain('github.com');
    });
  });
  
  describe('SlackIntegration', () => {
    it('should create instance', () => {
      const s = new SlackIntegration({ webhookUrl: 'https://hooks.slack.com/test' });
      expect(s).toBeDefined();
    });
    it('should send notification', async () => {
      const s = new SlackIntegration({ webhookUrl: 'https://hooks.slack.com/test' });
      await expect(s.sendNotification({ text: 'Test' })).resolves.not.toThrow();
    });
  });
  
  describe('WebhookIntegration', () => {
    it('should create instance', () => {
      const w = new WebhookIntegration({ url: 'https://example.com', events: ['*'] });
      expect(w).toBeDefined();
    });
  });
  
  describe('IntegrationManager', () => {
    it('should create with config', () => {
      const m = createIntegrationManager({ slack: { webhookUrl: 'https://hooks.slack.com/test' } });
      expect(m).toBeDefined();
      expect(m.getSlack()).toBeDefined();
    });
    it('should get GitHub', () => {
      const m = createIntegrationManager({ github: { token: 't', owner: 'o', repo: 'r' } });
      expect(m.getGitHub()).toBeDefined();
    });
    it('should add webhook', () => {
      const m = createIntegrationManager({});
      const w = m.addWebhook({ url: 'https://example.com', events: ['*'] });
      expect(w).toBeDefined();
    });
  });
});
