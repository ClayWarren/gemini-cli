/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { type Key as InkKey, useInput } from 'ink';
import {
  Config,
  GeminiClient,
  GeminiEventType as ServerGeminiEventType,
  ServerGeminiStreamEvent as GeminiEvent,
  ServerGeminiContentEvent as ContentEvent,
  ServerGeminiErrorEvent as ErrorEvent,
  ServerGeminiChatCompressedEvent,
  getErrorMessage,
  isNodeError,
  MessageSenderType,
  ToolCallRequestInfo,
  logUserPrompt,
  EditorType,
  ThoughtSummary,
  UnauthorizedError,
  UserPromptEvent,
} from '@google/gemini-cli-core';
import { type PartListUnion } from '@google/genai';
import {
  StreamingState,
  HistoryItem,
  HistoryItemWithoutId,
  HistoryItemToolGroup,
  MessageType,
  ToolCallStatus,
  IndividualToolCallDisplay,
} from '../types.js';
import { isAtCommand } from '../utils/commandUtils.js';
import { parseAndFormatApiError } from '../utils/errorParsing.js';
import { useShellCommandProcessor } from './shellCommandProcessor.js';
import { handleAtCommand } from './atCommandProcessor.js';
import { findLastSafeSplitPoint } from '../utils/markdownUtilities.js';
import { useStateAndRef } from './useStateAndRef.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useLogger } from './useLogger.js';
import {
  useReactToolScheduler,
  mapToDisplay as mapTrackedToolCallsToDisplay,
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';
import { useSessionStats } from '../contexts/SessionContext.js';

export function mergePartListUnions(list: PartListUnion[]): PartListUnion {
  const resultParts: PartListUnion = [];
  for (const item of list) {
    if (Array.isArray(item)) {
      resultParts.push(...item);
    } else {
      resultParts.push(item);
    }
  }
  return resultParts;
}

enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

export type UseGeminiStreamReturn = {
  initError: string | null;
  streamingState: StreamingState;
  submitQuery: (
    query: PartListUnion,
    options?: { isContinuation?: boolean },
  ) => Promise<void>;
  scheduleToolCalls: (
    toolCallRequests: ToolCallRequestInfo[],
    signal: AbortSignal,
  ) => void;
  markToolsAsSubmitted: (callIds: string[]) => void;
  thought: ThoughtSummary | null;
  messageQueue: string[];
  pendingGeminiHistoryItems: Array<HistoryItemWithoutId | HistoryItemToolGroup>;
};

/**
 * Manages the Gemini stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
 */
export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>,
  config: Config,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<
    import('./slashCommandProcessor.js').SlashCommandActionReturn | boolean
  >,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
): UseGeminiStreamReturn => {
  const [messageQueue, setMessageQueue] = useState<string[]>([]);
  const [initError, _setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnCancelledRef = useRef(false);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const _processedMemoryToolsRef = useRef<Set<string>>(new Set());
  const logger = useLogger();
  const { startNewTurn, addUsage } = useSessionStats();

  const handleToolCompletion = useCallback(
    (completedToolCallsFromScheduler: TrackedToolCall[]) => {
      // This onComplete is called when ALL scheduled tools for a given batch are done.
      if (completedToolCallsFromScheduler.length > 0) {
        // Add the final state of these tools to the history for display.
        // The new useEffect will handle submitting their responses.
        addItem(
          mapTrackedToolCallsToDisplay(completedToolCallsFromScheduler),
          Date.now(),
        );
      }
    },
    [addItem],
  );

  const [toolCalls, scheduleToolCalls, markToolsAsSubmitted] =
    useReactToolScheduler(
      handleToolCompletion,
      config,
      setPendingHistoryItem,
      getPreferredEditor,
    );

  const pendingToolCallGroupDisplay = useMemo(
    () =>
      toolCalls.length ? mapTrackedToolCallsToDisplay(toolCalls) : undefined,
    [toolCalls],
  );

  const onExec = useCallback(async (done: Promise<void>) => {
    setIsResponding(true);
    await done;
    setIsResponding(false);
  }, []);
  const { handleShellCommand } = useShellCommandProcessor(
    addItem,
    setPendingHistoryItem,
    onExec,
    onDebugMessage,
    config,
    geminiClient,
  );

  const streamingState = useMemo(() => {
    if (
      toolCalls.some((tc: TrackedToolCall) => tc.status === 'awaiting_approval')
    ) {
      return StreamingState.WaitingForConfirmation;
    }
    if (
      isResponding ||
      toolCalls.some(
        (tc: TrackedToolCall) =>
          tc.status === 'executing' ||
          tc.status === 'scheduled' ||
          tc.status === 'validating' ||
          ((tc.status === 'success' ||
            tc.status === 'error' ||
            tc.status === 'cancelled') &&
            !(tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
              .responseSubmittedToGemini),
      )
    ) {
      return StreamingState.Responding;
    }
    return StreamingState.Idle;
  }, [isResponding, toolCalls]);

  useInput((_input: string, key: InkKey) => {
    if (streamingState === StreamingState.Responding && key.escape) {
      if (turnCancelledRef.current) {
        return;
      }
      turnCancelledRef.current = true;
      abortControllerRef.current?.abort();
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, Date.now());
      }
      addItem(
        {
          type: MessageType.INFO,
          text: 'Request cancelled.',
        },
        Date.now(),
      );
      setPendingHistoryItem(null);
      setIsResponding(false);
    }
  });

  const prepareQueryForGemini = useCallback(
    async (
      query: PartListUnion,
      userMessageTimestamp: number,
      abortSignal: AbortSignal,
    ): Promise<{
      queryToSend: PartListUnion | null;
      shouldProceed: boolean;
    }> => {
      if (turnCancelledRef.current) {
        return { queryToSend: null, shouldProceed: false };
      }
      if (typeof query === 'string' && query.trim().length === 0) {
        return { queryToSend: null, shouldProceed: false };
      }

      let localQueryToSendToGemini: PartListUnion | null = null;

      if (typeof query === 'string') {
        const trimmedQuery = query.trim();
        logUserPrompt(
          config,
          new UserPromptEvent(trimmedQuery.length, trimmedQuery),
        );
        onDebugMessage(`User query: '${trimmedQuery}'`);
        await logger?.logMessage(MessageSenderType.USER, trimmedQuery);

        // Handle UI-only commands first
        const slashCommandResult = await handleSlashCommand(trimmedQuery);
        if (typeof slashCommandResult === 'boolean' && slashCommandResult) {
          // Command was handled, and it doesn't require a tool call from here
          return { queryToSend: null, shouldProceed: false };
        } else if (
          typeof slashCommandResult === 'object' &&
          slashCommandResult.shouldScheduleTool
        ) {
          // Slash command wants to schedule a tool call (e.g., /memory add)
          const { toolName, toolArgs } = slashCommandResult;
          if (toolName && toolArgs) {
            const toolCallRequest: ToolCallRequestInfo = {
              callId: `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              name: toolName,
              args: toolArgs,
              isClientInitiated: true,
            };
            scheduleToolCalls([toolCallRequest], abortSignal);
          }
          return { queryToSend: null, shouldProceed: false }; // Handled by scheduling the tool
        }

        if (shellModeActive && handleShellCommand(trimmedQuery, abortSignal)) {
          return { queryToSend: null, shouldProceed: false };
        }

        // Handle @-commands (which might involve tool calls)
        if (isAtCommand(trimmedQuery)) {
          const atCommandResult = await handleAtCommand({
            query: trimmedQuery,
            config,
            addItem,
            onDebugMessage,
            messageId: userMessageTimestamp,
            signal: abortSignal,
          });
          if (!atCommandResult.shouldProceed) {
            return { queryToSend: null, shouldProceed: false };
          }
          localQueryToSendToGemini = atCommandResult.processedQuery;
        } else {
          // Normal query for Gemini
          addItem(
            { type: MessageType.USER, text: trimmedQuery },
            userMessageTimestamp,
          );
          localQueryToSendToGemini = trimmedQuery;
        }
      } else {
        // It's a function response (PartListUnion that isn't a string)
        localQueryToSendToGemini = query;
      }

      if (localQueryToSendToGemini === null) {
        onDebugMessage(
          'Query processing resulted in null, not sending to Gemini.',
        );
        return { queryToSend: null, shouldProceed: false };
      }
      return { queryToSend: localQueryToSendToGemini, shouldProceed: true };
    },
    [
      config,
      addItem,
      onDebugMessage,
      handleShellCommand,
      handleSlashCommand,
      logger,
      shellModeActive,
      scheduleToolCalls,
    ],
  );

  // --- Stream Event Handlers ---

  const handleContentEvent = useCallback(
    (
      eventValue: ContentEvent['value'],
      currentGeminiMessageBuffer: string,
      userMessageTimestamp: number,
    ): string => {
      if (turnCancelledRef.current) {
        // Prevents additional output after a user initiated cancel.
        return '';
      }
      let newGeminiMessageBuffer = currentGeminiMessageBuffer + eventValue;
      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem({ type: 'gemini', text: '' });
        newGeminiMessageBuffer = eventValue;
      }
      // Split large messages for better rendering performance. Ideally,
      // we should maximize the amount of output sent to <Static />.
      const splitPoint = findLastSafeSplitPoint(newGeminiMessageBuffer);
      if (splitPoint === newGeminiMessageBuffer.length) {
        // Update the existing message with accumulated content
        setPendingHistoryItem((item: HistoryItemWithoutId | null) => ({
          type: item?.type as 'gemini' | 'gemini_content',
          text: newGeminiMessageBuffer,
        }));
      } else {
        // This indicates that we need to split up this Gemini Message.
        // Splitting a message is primarily a performance consideration. There is a
        // <Static> component at the root of App.tsx which takes care of rendering
        // content statically or dynamically. Everything but the last message is
        // treated as static in order to prevent re-rendering an entire message history
        // multiple times per-second (as streaming occurs). Prior to this change you'd
        // see heavy flickering of the terminal. This ensures that larger messages get
        // broken up so that there are more "statically" rendered.
        const beforeText = newGeminiMessageBuffer.substring(0, splitPoint);
        const afterText = newGeminiMessageBuffer.substring(splitPoint);
        addItem(
          {
            type: pendingHistoryItemRef.current?.type as
              | 'gemini'
              | 'gemini_content',
            text: beforeText,
          },
          userMessageTimestamp,
        );
        setPendingHistoryItem({ type: 'gemini_content', text: afterText });
        newGeminiMessageBuffer = afterText;
      }
      return newGeminiMessageBuffer;
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleUserCancelledEvent = useCallback(
    (userMessageTimestamp: number) => {
      if (turnCancelledRef.current) {
        return;
      }
      if (pendingHistoryItemRef.current) {
        if (pendingHistoryItemRef.current.type === 'tool_group') {
          const updatedTools = pendingHistoryItemRef.current.tools.map(
            (tool: IndividualToolCallDisplay) =>
              tool.status === ToolCallStatus.Pending ||
              tool.status === ToolCallStatus.Confirming ||
              tool.status === ToolCallStatus.Executing
                ? { ...tool, status: ToolCallStatus.Canceled }
                : tool,
          );
          const pendingItem: HistoryItemToolGroup = {
            ...pendingHistoryItemRef.current,
            tools: updatedTools,
          };
          addItem(pendingItem, userMessageTimestamp);
        } else {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem(null);
      }
      addItem(
        { type: MessageType.INFO, text: 'User cancelled the request.' },
        userMessageTimestamp,
      );
      setIsResponding(false);
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleErrorEvent = useCallback(
    (eventValue: ErrorEvent['value'], userMessageTimestamp: number) => {
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            eventValue.error,
            config.getContentGeneratorConfig().authType,
          ),
        },
        userMessageTimestamp,
      );
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, config],
  );

  const handleChatCompressionEvent = useCallback(
    (eventValue: ServerGeminiChatCompressedEvent['value']) =>
      addItem(
        {
          type: 'info',
          text:
            `IMPORTANT: This conversation approached the input token limit for ${config.getModel()}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${eventValue?.originalTokenCount ?? 'unknown'} to ` +
            `${eventValue?.newTokenCount ?? 'unknown'} tokens).`,
        },
        Date.now(),
      ),
    [addItem, config],
  );

  const processGeminiStreamEvents = useCallback(
    async (
      stream: AsyncIterable<GeminiEvent>,
      userMessageTimestamp: number,
      signal: AbortSignal,
    ): Promise<StreamProcessingStatus> => {
      let geminiMessageBuffer = '';
      const toolCallRequests: ToolCallRequestInfo[] = [];
      for await (const event of stream) {
        switch (event.type) {
          case ServerGeminiEventType.Thought:
            setThought(event.value);
            break;
          case ServerGeminiEventType.Content:
            geminiMessageBuffer = handleContentEvent(
              event.value,
              geminiMessageBuffer,
              userMessageTimestamp,
            );
            break;
          case ServerGeminiEventType.ToolCallRequest:
            toolCallRequests.push(event.value);
            break;
          case ServerGeminiEventType.UserCancelled:
            handleUserCancelledEvent(userMessageTimestamp);
            break;
          case ServerGeminiEventType.Error:
            handleErrorEvent(event.value, userMessageTimestamp);
            break;
          case ServerGeminiEventType.ChatCompressed:
            handleChatCompressionEvent(event.value);
            break;
          case ServerGeminiEventType.UsageMetadata:
            addUsage(event.value);
            break;
          case ServerGeminiEventType.ToolCallConfirmation:
          case ServerGeminiEventType.ToolCallResponse:
            // do nothing
            break;
          default: {
            // enforces exhaustive switch-case
            break;
          }
        }
      }
      if (toolCallRequests.length > 0) {
        scheduleToolCalls(toolCallRequests, signal);
      }
      return StreamProcessingStatus.Completed;
    },
    [
      handleContentEvent,
      handleUserCancelledEvent,
      handleErrorEvent,
      scheduleToolCalls,
      handleChatCompressionEvent,
      addUsage,
    ],
  );

  const submitQuery = useCallback(
    async (query: PartListUnion, options?: { isContinuation?: boolean }) => {
      // If a query is already in progress and this is new user input,
      // add it to the queue and return.
      if (
        (streamingState === StreamingState.Responding ||
          streamingState === StreamingState.WaitingForConfirmation) &&
        !options?.isContinuation
      ) {
        if (typeof query === 'string') {
          const queries = query.split('\n').filter((q) => q.trim().length > 0);
          if (queries.length > 0) {
            setMessageQueue((prev: string[]) => [...prev, ...queries]);
          }
        }
        return;
      }

      // Start of a new turn.
      startNewTurn();
      // Reset cancellation flag for the new turn.
      turnCancelledRef.current = false;
      // Create a new AbortController for this turn.
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      const userMessageTimestamp = Date.now();

      // If there are messages in the queue, process the first one.
      if (messageQueue.length > 0 && !options?.isContinuation) {
        const nextQuery = messageQueue[0];
        setMessageQueue((prev: string[]) => prev.slice(1));
        // Immediately start the next query from the queue.
        // This recursive call will handle the entire queue.
        void submitQuery(nextQuery, { isContinuation: false });
        return; // The recursive call will handle the rest.
      }

      setIsResponding(true);
      setThought(null);

      const { queryToSend, shouldProceed } = await prepareQueryForGemini(
        query,
        userMessageTimestamp,
        abortController.signal,
      );

      if (!shouldProceed) {
        setIsResponding(false);
        // If there are more items in the queue, process the next one.
        if (messageQueue.length > 0) {
          const nextQuery = messageQueue[0];
          setMessageQueue((prev: string[]) => prev.slice(1));
          void submitQuery(nextQuery, { isContinuation: false });
        }
        return;
      }

      let streamProcessingStatus: StreamProcessingStatus =
        StreamProcessingStatus.Completed;
      let hasError = false;

      try {
        await performMemoryRefresh();
        const stream = geminiClient.sendMessageStream(
          queryToSend!,
          abortController.signal,
        );
        streamProcessingStatus = await processGeminiStreamEvents(
          stream,
          userMessageTimestamp,
          abortController.signal,
        );
      } catch (e: unknown) {
        hasError = true;
        if (e instanceof UnauthorizedError) {
          onAuthError();
        } else if (isNodeError(e) && e.code === 'ERR_CANCELED') {
          // This is expected when the user cancels the request.
          streamProcessingStatus = StreamProcessingStatus.UserCancelled;
        } else {
          const errorMessage = getErrorMessage(e);
          handleErrorEvent(
            { error: { message: errorMessage } },
            userMessageTimestamp,
          );
        }
      } finally {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
          setPendingHistoryItem(null);
        }

        setIsResponding(false);
        abortControllerRef.current = null;

        // If the turn was not cancelled and there are no pending tool calls,
        // and there are more items in the queue, process the next one.
        if (
          !turnCancelledRef.current &&
          !hasError &&
          streamProcessingStatus === StreamProcessingStatus.Completed &&
          toolCalls.length === 0 &&
          messageQueue.length > 0
        ) {
          const nextQuery = messageQueue[0];
          setMessageQueue((prev: string[]) => prev.slice(1));
          void submitQuery(nextQuery, { isContinuation: false });
        }
      }
    },
    [
      streamingState,
      messageQueue,
      prepareQueryForGemini,
      performMemoryRefresh,
      geminiClient,
      processGeminiStreamEvents,
      onAuthError,
      handleErrorEvent,
      pendingHistoryItemRef,
      addItem,
      setPendingHistoryItem,
      toolCalls.length,
      startNewTurn,
    ],
  );

  useEffect(() => {
    // This effect is responsible for automatically submitting tool call
    // responses back to the Gemini API after they have completed.
    const completedAndUnsubmittedTools = toolCalls.filter(
      (tc): tc is TrackedCompletedToolCall | TrackedCancelledToolCall =>
        (tc.status === 'success' ||
          tc.status === 'error' ||
          tc.status === 'cancelled') &&
        !tc.responseSubmittedToGemini,
    );

    if (completedAndUnsubmittedTools.length > 0) {
      const toolParts = completedAndUnsubmittedTools.map(
        (tool) => tool.response.responseParts,
      );
      markToolsAsSubmitted(
        completedAndUnsubmittedTools.map((tool) => tool.request.callId),
      );

      // We are kicking off a new "turn" with the tool responses.
      // The `isContinuation` flag tells `submitQuery` not to queue this,
      // but to send it directly to the API.
      void submitQuery(mergePartListUnions(toolParts), {
        isContinuation: true,
      });
      markToolsAsSubmitted(
        completedAndUnsubmittedTools.map((tool) => tool.request.callId),
      );
    }
  }, [toolCalls, submitQuery, markToolsAsSubmitted]);

  const pendingGeminiHistoryItems = useMemo(() => {
    const items: Array<HistoryItemWithoutId | HistoryItemToolGroup> = [];
    if (pendingHistoryItemRef.current) {
      items.push(pendingHistoryItemRef.current);
    }
    if (pendingToolCallGroupDisplay) {
      // Check if the tool group is already represented by a pending item
      // to avoid duplicates. This can happen during the tool lifecycle.
      if (
        !(
          pendingHistoryItemRef.current?.type === 'tool_group' &&
          pendingHistoryItemRef.current.tools.every(
            (t: IndividualToolCallDisplay, i: number) =>
              pendingToolCallGroupDisplay.tools[i]
                ? t.callId === pendingToolCallGroupDisplay.tools[i].callId
                : false,
          )
        )
      ) {
        items.push(pendingToolCallGroupDisplay);
      }
    }
    return items;
  }, [pendingHistoryItemRef, pendingToolCallGroupDisplay]);

  return {
    initError,
    streamingState,
    submitQuery,
    scheduleToolCalls,
    markToolsAsSubmitted,
    thought,
    messageQueue,
    pendingGeminiHistoryItems,
  };
};
