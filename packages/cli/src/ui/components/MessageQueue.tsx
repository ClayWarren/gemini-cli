/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';

interface MessageQueueProps {
  messages: string[];
}

export const MessageQueue = ({ messages }: MessageQueueProps) => {
  if (messages.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" padding={1}>
      <Text bold>Message Queue ({messages.length})</Text>
      {messages.map((message, index) => (
        <Text key={index}>- {message}</Text>
      ))}
    </Box>
  );
};
