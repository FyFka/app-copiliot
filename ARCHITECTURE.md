# Core Architecture

<img width="1195" height="1595" alt="image" src="https://github.com/user-attachments/assets/8dcaedc5-7be9-4e11-9ab3-6ab6167fb5f2" />

# Data Flow

1. USER → UI  
2. UI → Core (IPC)  
3. Core → ContextService → OS APIs  
4. ContextService → LLMService  
5. LLMService → LLM Providers  
6. LLM → returns (text | tool_calls)  
7. → ToolService (validate)  
8. → AutomationService (execute)  
9. → Host Application  
