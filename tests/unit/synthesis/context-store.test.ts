import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

// Mock node:fs
vi.mock('node:fs', () => ({
  readFileSync: mock.fn(),
  writeFileSync: mock.fn(),
  existsSync: mock.fn(),
}));

// Mock logger
vi.mock('../../../src/utils/logger.ts', () => ({
  getLogger: () => ({
    debug: mock.fn(),
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    child: () => ({
      debug: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    }),
  }),
}));

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { ContextStore } from '../../../src/synthesis/context-store.ts';

describe('ContextStore', () => {
  let store: ContextStore;

  beforeEach(() => {
    vi.resetAllMocks();
    store = new ContextStore();
  });

  describe('load', () => {
    it('should return empty object when cdk.context.json does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = store.load('/project');

      assert.deepStrictEqual(result, {});
    });

    it('should load and parse cdk.context.json', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          'availability-zones:account=123456789012:region=us-east-1': [
            'us-east-1a',
            'us-east-1b',
          ],
          'vpc-provider:account=123456789012:region=us-east-1': {
            vpcId: 'vpc-12345',
          },
        })
      );

      const result = store.load('/project');

      expect(result).toEqual({
        'availability-zones:account=123456789012:region=us-east-1': [
          'us-east-1a',
          'us-east-1b',
        ],
        'vpc-provider:account=123456789012:region=us-east-1': {
          vpcId: 'vpc-12345',
        },
      });
      expect(readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('cdk.context.json'),
        'utf-8'
      );
    });

    it('should handle invalid JSON gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{ invalid json !!!');

      const result = store.load('/project');

      assert.deepStrictEqual(result, {});
    });
  });

  describe('save', () => {
    it('should save new context values to cdk.context.json', () => {
      // load() is called internally by save(), so mock existsSync for that
      vi.mocked(existsSync).mockReturnValue(false);

      store.save({ 'my-key': 'my-value' }, '/project');

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('cdk.context.json'),
        JSON.stringify({ 'my-key': 'my-value' }, null, 2) + '\n',
        'utf-8'
      );
    });

    it('should merge with existing values', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ existing: 'value' })
      );

      store.save({ newKey: 'newValue' }, '/project');

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('cdk.context.json'),
        JSON.stringify({ existing: 'value', newKey: 'newValue' }, null, 2) + '\n',
        'utf-8'
      );
    });

    it('should skip transient values ($dontSaveContext: true)', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      store.save(
        {
          'good-key': 'good-value',
          'transient-key': { $dontSaveContext: true, error: 'provider failed' },
        },
        '/project'
      );

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('cdk.context.json'),
        JSON.stringify({ 'good-key': 'good-value' }, null, 2) + '\n',
        'utf-8'
      );
    });

    it('should overwrite existing values with same key', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ myKey: 'oldValue' })
      );

      store.save({ myKey: 'newValue' }, '/project');

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('cdk.context.json'),
        JSON.stringify({ myKey: 'newValue' }, null, 2) + '\n',
        'utf-8'
      );
    });

    it('should not skip non-transient object values', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      store.save(
        {
          'normal-object': { someData: 'value', nested: true },
        },
        '/project'
      );

      expect(writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('cdk.context.json'),
        JSON.stringify({ 'normal-object': { someData: 'value', nested: true } }, null, 2) + '\n',
        'utf-8'
      );
    });
  });
});
