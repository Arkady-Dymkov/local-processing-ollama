# Ollama Transcript Processor for Obsidian

This plugin allows you to process meeting transcripts with locally running Ollama language models to generate concise, well-structured notes.

## Features

- Process meeting transcripts with locally running language models via Ollama
- Select from multiple saved prompts or create your own
- Customize the default model and Ollama connection settings
- Import and export prompts for sharing or backup
- Preserve original transcript in a collapsible block
- Format AI-generated notes with proper Markdown structure

## Requirements

- [Obsidian](https://obsidian.md/) v0.15.0 or higher
- [Ollama](https://ollama.ai/) installed and running on your computer
- At least one language model pulled in Ollama (default: gemma:3b)

## Installation

### Prerequisites

1. Make sure you have [Ollama](https://ollama.ai/) installed and running on your computer.
2. Pull at least one language model in Ollama (the default is gemma:3b):
   ```bash
   ollama pull gemma:3b
   ```

### Installing the Plugin

#### From Obsidian Community Plugins (Coming Soon)

1. Open Obsidian and go to Settings
2. Navigate to Community plugins and turn off "Restricted mode"
3. Click "Browse" and search for "Ollama Transcript Processor"
4. Click "Install" and then "Enable"

#### Manual Installation

1. Download the latest release from the GitHub releases page
2. Extract the zip file into your Obsidian vault's `.obsidian/plugins/` directory
3. Restart Obsidian
4. Go to Settings > Community plugins and enable "Ollama Transcript Processor"

## Usage

### Basic Workflow

1. Open or create a note containing a meeting transcript
2. Trigger the plugin using one of these methods:
   - Click the document icon in the left ribbon
   - Use the command palette and select "Process with LLM prompt..."
   - Use a custom hotkey (if configured)
3. Select a prompt from the list or create a new one
4. Wait for the processing to complete
5. The original transcript will be preserved in a collapsible block, and the AI-generated notes will appear below

### Re-running the Last Prompt

If you want to process the same note again with the last used prompt:
1. Use the command palette and select "Re-run last prompt"
2. The note will be processed again with the same prompt

### Managing Prompts

You can manage your prompts in the plugin settings:
1. Go to Settings > Ollama Transcript Processor
2. Under "Prompt Management", you can:
   - View all saved prompts
   - Add new prompts
   - Edit existing prompts
   - Delete prompts
   - Import/export prompts as JSON

### Configuring Ollama Connection

1. Go to Settings > Ollama Transcript Processor
2. Under "Ollama Connection", set the URL of your Ollama instance (default: http://localhost:11434)
3. Under "Model Settings", select your default model from the dropdown or enter a model name

## Troubleshooting

### Ollama Connection Issues

- Make sure Ollama is running on your computer
- Check that the Ollama host URL in the plugin settings is correct
- Verify that you have pulled the model you're trying to use

### Processing Large Transcripts

For very large transcripts:
- Consider breaking them into smaller chunks
- Use a model with a larger context window if available
- Be patient, as processing large texts can take time

## Development

### Building the Plugin

This project includes a Makefile to simplify the build and deployment process:

```bash
# Build the plugin
make build

# Deploy the plugin to your Obsidian vault
make deploy

# Show all available commands
make help
```

The `deploy` command will build the plugin and copy it to the Obsidian plugins directory at:
`/Users/Arkadiy.Dymkov/obs/Personal/.obsidian/plugins/ollama-transcript-processor`

### Manual Build

If you prefer not to use the Makefile, you can build the plugin manually:

```bash
# Install dependencies
npm install

# Build the plugin
npm run build
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
