// AI Chatbot JavaScript
class RentifyChatbot {
  constructor() {
    this.isOpen = false;
    this.sessionId = this.generateSessionId();
    this.messageCount = 0;
    this.maxMessages = 10;
    
    this.initializeElements();
    this.bindEvents();
    this.loadChatHistory();
  }

  generateSessionId() {
    return 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  initializeElements() {
    this.chatbotIcon = document.getElementById('chatbot-icon');
    this.chatWindow = document.getElementById('chat-window');
    this.chatMessages = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('send-message');
    this.minimizeBtn = document.getElementById('minimize-chat');
    this.loadingTemplate = document.getElementById('loading-template');
  }

  bindEvents() {
    // Toggle chat window
    this.chatbotIcon.addEventListener('click', () => this.toggleChat());
    this.minimizeBtn.addEventListener('click', () => this.closeChat());

    // Send message
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Enable/disable send button based on input
    this.chatInput.addEventListener('input', () => {
      this.sendBtn.disabled = !this.chatInput.value.trim();
    });

    // Auto-resize input
    this.chatInput.addEventListener('input', () => {
      this.chatInput.style.height = 'auto';
      this.chatInput.style.height = Math.min(this.chatInput.scrollHeight, 100) + 'px';
    });
  }

  toggleChat() {
    if (this.isOpen) {
      this.closeChat();
    } else {
      this.openChat();
    }
  }

  openChat() {
    this.isOpen = true;
    this.chatWindow.classList.add('active');
    this.chatbotIcon.style.display = 'none';
    this.chatInput.focus();
    this.scrollToBottom();
  }

  closeChat() {
    this.isOpen = false;
    this.chatWindow.classList.remove('active');
    this.chatbotIcon.style.display = 'flex';
  }

  async sendMessage() {
    const message = this.chatInput.value.trim();
    if (!message) return;

    // Add user message to chat
    this.addMessage('user', message);
    this.chatInput.value = '';
    this.sendBtn.disabled = true;
    this.chatInput.style.height = 'auto';

    // Show loading indicator
    const loadingElement = this.showLoading();

    try {
      // Send message to backend
      const response = await fetch('/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: message,
          sessionId: this.sessionId
        })
      });

      const data = await response.json();
      console.log('Chat response:', data); // Debug log

      // Remove loading indicator first
      this.hideLoading(loadingElement);

      if (data.success) {
        // Add bot response
        this.addMessage('bot', data.response);
        this.sessionId = data.sessionId;
        this.messageCount = data.messageCount;
      } else {
        this.addMessage('bot', data.error || 'Sorry, I encountered an error. Please try again.');
      }
    } catch (error) {
      console.error('Chat error:', error);
      // Make sure to remove loading indicator even on error
      this.hideLoading(loadingElement);
      this.addMessage('bot', 'Sorry, I\'m having trouble connecting. Please check your internet connection and try again.');
    }
  }

  addMessage(type, content) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type}-message new-message`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    
    if (type === 'bot') {
      avatar.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10h5l3 3v-3c1.66 0 3-1.34 3-3V9c0-3.87-3.13-7-7-7z" fill="currentColor"/>
          <circle cx="8.5" cy="9.5" r="1.5" fill="white"/>
          <circle cx="15.5" cy="9.5" r="1.5" fill="white"/>
          <path d="M8 14h8c.55 0 1-.45 1-1s-.45-1-1-1H8c-.55 0-1 .45-1 1s.45 1 1 1z" fill="white"/>
        </svg>
      `;
    } else {
      avatar.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/>
        </svg>
      `;
    }

    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = this.formatMessage(content);

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = this.getCurrentTime();

    messageContent.appendChild(bubble);
    messageContent.appendChild(time);

    messageElement.appendChild(avatar);
    messageElement.appendChild(messageContent);

    this.chatMessages.appendChild(messageElement);
    this.scrollToBottom();

    // Remove animation class after animation completes
    setTimeout(() => {
      messageElement.classList.remove('new-message');
    }, 500);

    // Keep only last maxMessages messages
    this.trimMessages();
  }

  formatMessage(content) {
    // Convert markdown-like formatting to HTML
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
  }

  showLoading() {
    const loadingElement = this.loadingTemplate.content.cloneNode(true);
    const loadingDiv = loadingElement.querySelector('.message');
    this.chatMessages.appendChild(loadingDiv);
    this.scrollToBottom();
    return loadingDiv;
  }

  hideLoading(loadingElement) {
    if (loadingElement && loadingElement.parentNode) {
      loadingElement.parentNode.removeChild(loadingElement);
    }
  }

  getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  scrollToBottom() {
    setTimeout(() => {
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }, 100);
  }

  trimMessages() {
    const messages = this.chatMessages.querySelectorAll('.message');
    if (messages.length > this.maxMessages) {
      const messagesToRemove = messages.length - this.maxMessages;
      for (let i = 0; i < messagesToRemove; i++) {
        messages[i].remove();
      }
    }
  }

  async loadChatHistory() {
    try {
      const response = await fetch(`/chat/history/${this.sessionId}`);
      const data = await response.json();
      
      if (data.messages && data.messages.length > 0) {
        // Clear welcome message
        this.chatMessages.innerHTML = '';
        
        // Add all messages from history
        data.messages.forEach(msg => {
          this.addMessage(msg.type, msg.content);
        });
        
        this.sessionId = data.sessionId;
        this.messageCount = data.messages.length;
      }
    } catch (error) {
      console.error('Error loading chat history:', error);
    }
  }

  // Public method to add quick action buttons
  addQuickActions() {
    const quickActions = document.createElement('div');
    quickActions.className = 'quick-actions';
    quickActions.innerHTML = `
      <div class="quick-action" data-action="find-properties">Find Properties</div>
      <div class="quick-action" data-action="list-property">List Property</div>
      <div class="quick-action" data-action="help">Get Help</div>
    `;
    
    this.chatMessages.appendChild(quickActions);
    
    // Add click handlers
    quickActions.querySelectorAll('.quick-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        this.handleQuickAction(action);
      });
    });
  }

  handleQuickAction(action) {
    let message = '';
    switch (action) {
      case 'find-properties':
        message = 'Show me available properties';
        break;
      case 'list-property':
        message = 'How can I list my property?';
        break;
      case 'help':
        message = 'I need help with the platform';
        break;
    }
    
    if (message) {
      this.chatInput.value = message;
      this.sendMessage();
    }
  }
}

// Initialize chatbot when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Check if chatbot elements exist
  if (document.getElementById('chatbot-widget')) {
    window.rentifyChatbot = new RentifyChatbot();
  }
});

// Export for potential external use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = RentifyChatbot;
}
