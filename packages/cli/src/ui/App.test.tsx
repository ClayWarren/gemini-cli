/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { render } from 'ink-testing-library';
import { AppWrapper as App } from './App.js';
import {
  Config as ServerConfig,
  MCPServerConfig,
  ApprovalMode,
  ToolRegistry,
  AccessibilitySettings,
  SandboxConfig,
} from '@google/gemini-cli-core';
import { LoadedSettings, Settings, SettingsFile } from '../config/settings.js';
import process from 'node:process';
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({
      isFile: vi.fn(() => true),
    })),
  };
});
import { ContextSummaryDisplay as OriginalContextSummaryDisplay } from './components/ContextSummaryDisplay.js';

vi.mock('./components/ContextSummaryDisplay.js', () => ({
  ContextSummaryDisplay: vi.fn(() => null),
}));

const ContextSummaryDisplay = vi.mocked(OriginalContextSummaryDisplay);

// Define a more complete mock server config based on actual Config
interface MockServerConfig {
  apiKey: string;
  model: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  debugMode: boolean;
  question?: string;
  fullContext: boolean;
  coreTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>; // Use imported MCPServerConfig
  userAgent: string;
  userMemory: string;
  geminiMdFileCount: number;
  approvalMode: ApprovalMode;
  vertexai?: boolean;
  showMemoryUsage?: boolean;
  accessibility?: AccessibilitySettings;
  embeddingModel: string;

  getApiKey: Mock<() => string>;
  getModel: Mock<() => string>;
  getSandbox: Mock<() => SandboxConfig | undefined>;
  getTargetDir: Mock<() => string>;
  getToolRegistry: Mock<() => ToolRegistry>; // Use imported ToolRegistry type
  getDebugMode: Mock<() => boolean>;
  getQuestion: Mock<() => string | undefined>;
  getFullContext: Mock<() => boolean>;
  getCoreTools: Mock<() => string[] | undefined>;
  getToolDiscoveryCommand: Mock<() => string | undefined>;
  getToolCallCommand: Mock<() => string | undefined>;
  getMcpServerCommand: Mock<() => string | undefined>;
  getMcpServers: Mock<() => Record<string, MCPServerConfig> | undefined>;
  getUserAgent: Mock<() => string>;
  getUserMemory: Mock<() => string>;
  setUserMemory: Mock<(newUserMemory: string) => void>;
  getGeminiMdFileCount: Mock<() => number>;
  setGeminiMdFileCount: Mock<(count: number) => void>;
  getApprovalMode: Mock<() => ApprovalMode>;
  setApprovalMode: Mock<(skip: ApprovalMode) => void>;
  getVertexAI: Mock<() => boolean | undefined>;
  getShowMemoryUsage: Mock<() => boolean>;
  getAccessibility: Mock<() => AccessibilitySettings>;
  getProjectRoot: Mock<() => string | undefined>;
  getAllGeminiMdFilenames: Mock<() => string[]>;
  getCheckpointingEnabled: Mock<() => boolean>;
  getGeminiClient: Mock<() => unknown>;
}

// Mock @google/gemini-cli-core and its Config class
vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actualCore =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  const ConfigClassMock = vi
    .fn()
    .mockImplementation((optionsPassedToConstructor) => {
      const opts = { ...optionsPassedToConstructor }; // Clone
      // Basic mock structure, will be extended by the instance in tests
      return {
        apiKey: opts.apiKey || 'test-key',
        model: opts.model || 'test-model-in-mock-factory',
        sandbox: opts.sandbox,
        targetDir: opts.targetDir || '/test/dir',
        debugMode: opts.debugMode || false,
        question: opts.question,
        fullContext: opts.fullContext ?? false,
        coreTools: opts.coreTools,
        toolDiscoveryCommand: opts.toolDiscoveryCommand,
        toolCallCommand: opts.toolCallCommand,
        mcpServerCommand: opts.mcpServerCommand,
        mcpServers: opts.mcpServers,
        userAgent: opts.userAgent || 'test-agent',
        userMemory: '',
        geminiMdFileCount: opts.geminiMdFileCount || 0,
        approvalMode: opts.approvalMode ?? ApprovalMode.DEFAULT,
        vertexai: opts.vertexai,
        showMemoryUsage: opts.showMemoryUsage ?? false,
        accessibility: opts.accessibility ?? {},
        embeddingModel: opts.embeddingModel || 'test-embedding-model',

        getApiKey: vi.fn(() => opts.apiKey || 'test-key'),
        getModel: vi.fn(() => opts.model || 'test-model-in-mock-factory'),
        getSandbox: vi.fn(() => opts.sandbox),
        getTargetDir: vi.fn(() => opts.targetDir || '/test/dir'),
        getToolRegistry: vi.fn(() => ({}) as ToolRegistry), // Simple mock
        getDebugMode: vi.fn(() => opts.debugMode || false),
        getQuestion: vi.fn(() => opts.question),
        getFullContext: vi.fn(() => opts.fullContext ?? false),
        getCoreTools: vi.fn(() => opts.coreTools),
        getToolDiscoveryCommand: vi.fn(() => opts.toolDiscoveryCommand),
        getToolCallCommand: vi.fn(() => opts.toolCallCommand),
        getMcpServerCommand: vi.fn(() => opts.mcpServerCommand),
        getMcpServers: vi.fn(() => opts.mcpServers),
        getUserAgent: vi.fn(() => opts.userAgent || 'test-agent'),
        getUserMemory: vi.fn(() => opts.userMemory || ''),
        setUserMemory: vi.fn(),
        getGeminiMdFileCount: vi.fn(() => opts.geminiMdFileCount || 0),
        setGeminiMdFileCount: vi.fn(),
        getApprovalMode: vi.fn(() => opts.approvalMode ?? ApprovalMode.DEFAULT),
        setApprovalMode: vi.fn(),
        getVertexAI: vi.fn(() => opts.vertexai),
        getShowMemoryUsage: vi.fn(() => opts.showMemoryUsage ?? false),
        getAccessibility: vi.fn(() => opts.accessibility ?? {}),
        getProjectRoot: vi.fn(() => opts.projectRoot),
        getAllGeminiMdFilenames: vi.fn(() => ['GEMINI.md']),
        setFlashFallbackHandler: vi.fn(),
        getCheckpointingEnabled: vi.fn(() => false),
        getGeminiClient: vi.fn(() => ({
          addHistory: vi.fn(),
          stream: vi.fn(),
          getAuthType: vi.fn(),
        })),
      };
    });
  return {
    ...actualCore,
    Config: ConfigClassMock,
    MCPServerConfig: actualCore.MCPServerConfig,
    getAllGeminiMdFilenames: vi.fn(() => ['GEMINI.md']),
  };
});

// Mock heavy dependencies or those with side effects
vi.mock('./hooks/useGeminiStream', () => ({
  useGeminiStream: vi.fn(() => ({
    streamingState: 'Idle',
    submitQuery: vi.fn(),
    initError: null,
    pendingGeminiHistoryItems: [],
    thought: null,
  })),
}));

vi.mock('./hooks/useLoadingIndicator', () => ({
  useLoadingIndicator: vi.fn(() => ({
    elapsedTime: 0,
    currentLoadingPhrase: 'Thinking...',
  })),
}));

vi.mock('./hooks/useGitBranchName', () => ({
  useGitBranchName: vi.fn(() => 'main'),
}));

vi.mock('ink', async (importOriginal) => {
  const actualInkModule = (await importOriginal()) as typeof import('ink');
  return {
    ...actualInkModule,
    useInput: vi.fn(),
    useStdin: vi.fn(() => ({
      stdin: { on: vi.fn(), off: vi.fn() },
      setRawMode: vi.fn(),
    })),
    useStdout: vi.fn(() => ({ stdout: { write: vi.fn() } })),
  };
});

vi.mock('./hooks/useHistoryManager', () => ({
  useHistory: vi.fn(() => ({
    history: [],
    addItem: vi.fn(),
    clearItems: vi.fn(),
    loadHistory: vi.fn(),
  })),
}));

vi.mock('./hooks/useConsoleMessages', () => ({
  useConsoleMessages: vi.fn(() => ({
    consoleMessages: [],
    handleNewMessage: vi.fn(),
    clearConsoleMessages: vi.fn(),
  })),
}));

vi.mock('./hooks/useThemeCommand', () => ({
  useThemeCommand: vi.fn(() => ({
    isThemeDialogOpen: false,
    openThemeDialog: vi.fn(),
    handleThemeSelect: vi.fn(),
    handleThemeHighlight: vi.fn(),
  })),
}));

vi.mock('./hooks/useAuthCommand', () => ({
  useAuthCommand: vi.fn(() => ({
    isAuthDialogOpen: false,
    openAuthDialog: vi.fn(),
    handleAuthSelect: vi.fn(),
    handleAuthHighlight: vi.fn(),
    isAuthenticating: false,
    cancelAuthentication: vi.fn(),
  })),
}));

vi.mock('./hooks/useEditorSettings', () => ({
  useEditorSettings: vi.fn(() => ({
    isEditorDialogOpen: false,
    openEditorDialog: vi.fn(),
    handleEditorSelect: vi.fn(),
    exitEditorDialog: vi.fn(),
  })),
}));

vi.mock('./hooks/slashCommandProcessor', () => ({
  useSlashCommandProcessor: vi.fn(() => ({
    handleSlashCommand: vi.fn(),
    slashCommands: [],
    pendingHistoryItems: [],
  })),
}));

vi.mock('./components/shared/text-buffer.js', () => ({
  useTextBuffer: vi.fn(() => ({
    buffer: { text: '' },
    text: '',
    setText: vi.fn(),
    cursorOffset: 0,
    setCursorOffset: vi.fn(),
    inputRef: { current: null },
    viewportVisualLines: [],
    visualCursor: [0, 0],
  })),
}));

vi.mock('../config/config.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    // @ts-expect-error - this is fine
    ...actual,
    loadHierarchicalGeminiMemory: vi
      .fn()
      .mockResolvedValue({ memoryContent: '', fileCount: 0 }),
  };
});

const createMockSettings = (
  settings: Partial<Settings> = {},
): LoadedSettings => {
  const userSettingsFile: SettingsFile = {
    path: '/user/settings.json',
    settings: {},
  };
  const workspaceSettingsFile: SettingsFile = {
    path: '/workspace/.gemini/settings.json',
    settings: {
      ...settings,
    },
  };
  return new LoadedSettings(userSettingsFile, workspaceSettingsFile, []);
};

describe('App UI', () => {
  let mockConfig: MockServerConfig;
  let mockSettings: LoadedSettings;
  let currentUnmount: (() => void) | undefined;

  beforeEach(() => {
    const ServerConfigMocked = vi.mocked(ServerConfig, true);
    mockConfig = new ServerConfigMocked({
      embeddingModel: 'test-embedding-model',
      sandbox: undefined,
      targetDir: '/test/dir',
      debugMode: false,
      userMemory: '',
      geminiMdFileCount: 0,
      showMemoryUsage: false,
      sessionId: 'test-session-id',
      cwd: '/tmp',
      model: 'model',
    }) as unknown as MockServerConfig;

    // Ensure the getShowMemoryUsage mock function is specifically set up if not covered by constructor mock
    if (!mockConfig.getShowMemoryUsage) {
      mockConfig.getShowMemoryUsage = vi.fn(() => false);
    }
    mockConfig.getShowMemoryUsage.mockReturnValue(false); // Default for most tests
    mockConfig.getCheckpointingEnabled = vi.fn(() => false);

    // Ensure a theme is set so the theme dialog does not appear.
    mockSettings = createMockSettings({ theme: 'Default' });

    // Reset geminiMdFileCount for each test to ensure isolation
  });

  afterEach(() => {
    if (currentUnmount) {
      currentUnmount();
      currentUnmount = undefined;
    }
    vi.clearAllMocks(); // Clear mocks after each test
  });

  it('should display default "GEMINI.md" in footer when contextFileName is not set and count is 1', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    // For this test, ensure showMemoryUsage is false or debugMode is false if it relies on that
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve(); // Wait for any async updates
    expect(ContextSummaryDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiMdFileCount: 1,
        contextFileNames: ['GEMINI.md'],
        mcpServers: undefined,
        showToolDescriptions: false,
      }),
      {},
    );
  });

  it('should display default "GEMINI.md" with plural when contextFileName is not set and count is > 1', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(ContextSummaryDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiMdFileCount: 2,
        contextFileNames: ['GEMINI.md'],
        mcpServers: undefined,
        showToolDescriptions: false,
      }),
      {},
    );
  });

  it('should display custom contextFileName in footer when set and count is 1', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'AGENTS.md',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(1);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(ContextSummaryDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiMdFileCount: 1,
        contextFileNames: ['AGENTS.md'],
        mcpServers: undefined,
        showToolDescriptions: false,
      }),
      {},
    );
  });

  it('should display a generic message when multiple context files with different names are provided', async () => {
    mockSettings = createMockSettings({
      contextFileName: ['AGENTS.md', 'CONTEXT.md'],
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(ContextSummaryDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiMdFileCount: 2,
        contextFileNames: ['AGENTS.md', 'CONTEXT.md'],
        mcpServers: undefined,
        showToolDescriptions: false,
      }),
      {},
    );
  });

  it('should display custom contextFileName with plural when set and count is > 1', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'MY_NOTES.TXT',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(3);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(ContextSummaryDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiMdFileCount: 3,
        contextFileNames: ['MY_NOTES.TXT'],
        mcpServers: undefined,
        showToolDescriptions: false,
      }),
      {},
    );
  });

  it('should not display context file message if count is 0, even if contextFileName is set', async () => {
    mockSettings = createMockSettings({
      contextFileName: 'ANY_FILE.MD',
      theme: 'Default',
    });
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(ContextSummaryDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiMdFileCount: 0,
        contextFileNames: ['ANY_FILE.MD'],
        mcpServers: undefined,
        showToolDescriptions: false,
      }),
      {},
    );
  });

  it('should display GEMINI.md and MCP server count when both are present', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(2);
    mockConfig.getMcpServers.mockReturnValue({
      server1: {} as MCPServerConfig,
    });
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(ContextSummaryDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiMdFileCount: 2,
        mcpServers: { server1: {} },
        showToolDescriptions: false,
      }),
      {},
    );
  });

  it('should display only MCP server count when GEMINI.md count is 0', async () => {
    mockConfig.getGeminiMdFileCount.mockReturnValue(0);
    mockConfig.getMcpServers.mockReturnValue({
      server1: {} as MCPServerConfig,
      server2: {} as MCPServerConfig,
    });
    mockConfig.getDebugMode.mockReturnValue(false);
    mockConfig.getShowMemoryUsage.mockReturnValue(false);

    const { unmount } = render(
      <App
        config={mockConfig as unknown as ServerConfig}
        settings={mockSettings}
      />,
    );
    currentUnmount = unmount;
    await Promise.resolve();
    expect(ContextSummaryDisplay).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiMdFileCount: 0,
        mcpServers: { server1: {}, server2: {} },
        showToolDescriptions: false,
      }),
      {},
    );
  });

  describe('when no theme is set', () => {
    let originalNoColor: string | undefined;

    beforeEach(() => {
      originalNoColor = process.env.NO_COLOR;
      // Ensure no theme is set for these tests
      mockSettings = createMockSettings({});
      mockConfig.getDebugMode.mockReturnValue(false);
      mockConfig.getShowMemoryUsage.mockReturnValue(false);
    });

    afterEach(() => {
      process.env.NO_COLOR = originalNoColor;
    });

    it('should display theme dialog if NO_COLOR is not set', async () => {
      delete process.env.NO_COLOR;

      const { lastFrame, unmount } = render(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
        />,
      );
      currentUnmount = unmount;

      expect(lastFrame()).toContain('Select Theme');
    });

    it('should display a message if NO_COLOR is set', async () => {
      process.env.NO_COLOR = 'true';

      const { lastFrame, unmount } = render(
        <App
          config={mockConfig as unknown as ServerConfig}
          settings={mockSettings}
        />,
      );
      currentUnmount = unmount;

      expect(lastFrame()).toContain(
        'Theme configuration unavailable due to NO_COLOR env variable.',
      );
      expect(lastFrame()).not.toContain('Select Theme');
    });
  });
});
