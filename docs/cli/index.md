# Gemini CLI

Within Gemini CLI, `packages/cli` is the frontend for users to send and receive prompts with the Gemini AI model and its associated tools. For a general overview of Gemini CLI, see the [main documentation page](../index.md).

## Navigating this section

- **[Authentication](./authentication.md):** A guide to setting up authentication with Google's AI services.
- **[Commands](./commands.md):** A reference for Gemini CLI commands (e.g., `/help`, `/tools`, `/theme`).
- **[Configuration](./configuration.md):** A guide to tailoring Gemini CLI behavior using configuration files.
- **[Token Caching](./token-caching.md):** Optimize API costs through token caching.
- **[Themes](./themes.md)**: A guide to customizing the CLI's appearance with different themes.
- **[Tutorials](tutorials.md)**: A tutorial showing how to use Gemini CLI to automate a development task.

## Non-interactive mode

Gemini CLI can be run in a non-interactive mode, which is useful for scripting and automation. In this mode, you can pipe input to the CLI.

### Single command

You can pipe a single command to the CLI, and it will execute the command and then exit.

The following example pipes a command to Gemini CLI from your terminal:

```bash
echo "What is fine tuning?" | gemini
```

Gemini CLI executes the command and prints the output to your terminal. Note that you can achieve the same behavior by using the `--prompt` or `-p` flag. For example:

```bash
gemini -p "What is fine tuning?"
```

### Multiple commands

You can also pipe multiple commands to the CLI. Each line of input is treated as a separate command. The CLI will execute the commands sequentially.

```bash
(echo "What is the capital of France?"; echo "What is the population of Paris?") | gemini
```

### Continuous input

If you run `gemini` without any input, it will enter a mode where it waits for input from `stdin`. You can then type commands and press Enter to execute them. The CLI will remain open and continue to accept commands until you close `stdin` (e.g., by pressing `Ctrl+D`). This allows you to "brain dump" a series of questions or commands and have them executed one after another without waiting for each one to complete.
