const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Allow your production frontend domain
    if (origin.includes('flexai') || origin.includes('onrender.com') || origin.includes('vercel.app') || origin.includes('netlify.app')) {
      return callback(null, true);
    }
    
    // Allow all origins for now (you can restrict this later)
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - Origin: ${req.headers.origin || 'No origin'} - User-Agent: ${req.headers['user-agent'] || 'No user-agent'}`);
  next();
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Store chat sessions in memory (in production, use a database)
const chatSessions = new Map();

// Initialize Gemini model
const model = genAI.getGenerativeModel({ 
  model: "gemini-2.5-flash",
  systemInstruction: `You are a friendly and knowledgeable fitness AI assistant. Your role is to help users with:

- Workout routines and exercise techniques
- Nutrition advice and meal planning
- Fitness motivation and goal setting
- Health and wellness tips
- Exercise form and safety
- use emojis not extensively but anywhere needed
- If asked to create table create table

Keep your responses:
- Conversational and encouraging
- Practical and actionable
- Focused on fitness and health topics
- Positive and motivational

If someone asks about non-fitness topics, politely redirect them to fitness-related questions. Always provide helpful, safe, and evidence-based fitness advice.`
});

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('[GET] /health endpoint hit');
  res.json({ status: 'OK', message: 'Gemini Fitness Assistant API is running!' });
});

// Start a new chat session
app.post('/api/chat/start', async (req, res) => {
  console.log('[POST] /api/chat/start endpoint hit');
  try {
    const sessionId = Date.now().toString();
    console.log('Creating new chat session with sessionId:', sessionId);
    
    // Create a new chat session
    const chat = model.startChat({
      history: [],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    });

    // Store the chat session
    chatSessions.set(sessionId, chat);
    console.log('Chat session stored. Total sessions:', chatSessions.size);

    // Send welcome message
    const welcomeMessage = "Hi! I'm your AI fitness assistant powered by Google Gemini. Ask me anything about workouts, nutrition, or fitness! 💪";

    res.json({
      sessionId,
      message: {
        id: Date.now(),
        text: welcomeMessage,
        sender: 'bot',
        timestamp: new Date().toISOString()
      }
    });
    console.log('Sent welcome message for session:', sessionId);
  } catch (error) {
    console.error('Error starting chat session:', error);
    res.status(500).json({ 
      error: 'Failed to start chat session',
      details: error.message 
    });
  }
});

// Send message to chat
app.post('/api/chat/message', async (req, res) => {
  console.log('[POST] /api/chat/message endpoint hit');
  try {
    const { sessionId, message, stream = false } = req.body;
    console.log('Incoming message:', message, 'for sessionId:', sessionId, 'stream:', stream);

    if (!sessionId || !message) {
      return res.status(400).json({ 
        error: 'Session ID and message are required' 
      });
    }

    // Get the chat session
    const chat = chatSessions.get(sessionId);
    if (!chat) {
      console.warn('Chat session not found for sessionId:', sessionId);
      return res.status(404).json({ 
        error: 'Chat session not found. Please start a new session.' 
      });
    }

    // Handle streaming response
    if (stream) {
      console.log('Starting streaming response for session:', sessionId);
      
      // Set headers for Server-Sent Events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
      });

      try {
        // Send message to Gemini with streaming
        const result = await chat.sendMessageStream(message);
        let fullResponse = '';
        
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          fullResponse += chunkText;
          
          // Send chunk to frontend
          res.write(`data: ${JSON.stringify({
            type: 'chunk',
            text: chunkText,
            sessionId: sessionId
          })}\n\n`);
        }

        // Send completion signal
        res.write(`data: ${JSON.stringify({
          type: 'complete',
          fullText: fullResponse,
          sessionId: sessionId
        })}\n\n`);
        
        console.log('Streaming completed for session:', sessionId);
        res.end();
        
      } catch (streamError) {
        console.error('Streaming error:', streamError);
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: 'Streaming failed',
          sessionId: sessionId
        })}\n\n`);
        res.end();
      }
      
    } else {
      // Non-streaming response (fallback)
      const result = await chat.sendMessage(message);
      const response = await result.response;
      const botReply = response.text();
      console.log('Gemini API reply:', botReply);

      res.json({
        message: {
          id: Date.now(),
          text: botReply,
          sender: 'bot',
          timestamp: new Date().toISOString()
        }
      });
      console.log('Sent bot reply for session:', sessionId);
    }

  } catch (error) {
    console.error('Error sending message:', error);
    
    // Fallback response if API fails
    const fallbackResponses = {
      workout: "Quick workout tip: Try 10 push-ups, 15 squats, 30-sec plank. Repeat 3x! 💪",
      diet: "Quick nutrition tip: Fill half your plate with veggies, quarter with protein, quarter with complex carbs! 🥗",
      motivation: "You're already winning by asking! 🏆 Every small step counts. Keep going, champion!",
      default: "I'm having trouble connecting right now. Please try again! 🤖"
    };

    const lowerMessage = req.body.message?.toLowerCase() || '';
    let fallbackText = fallbackResponses.default;

    if (lowerMessage.includes('workout') || lowerMessage.includes('exercise')) {
      fallbackText = fallbackResponses.workout;
    } else if (lowerMessage.includes('diet') || lowerMessage.includes('nutrition')) {
      fallbackText = fallbackResponses.diet;
    } else if (lowerMessage.includes('motivation')) {
      fallbackText = fallbackResponses.motivation;
    }

    res.json({
      message: {
        id: Date.now(),
        text: fallbackText + " (Offline mode)",
        sender: 'bot',
        timestamp: new Date().toISOString()
      },
      isOffline: true
    });
    console.log('Sent fallback response for session:', req.body.sessionId);
  }
});

// Get chat history
app.get('/api/chat/history/:sessionId', async (req, res) => {
  console.log('[GET] /api/chat/history/' + req.params.sessionId + ' endpoint hit');
  try {
    const { sessionId } = req.params;
    const chat = chatSessions.get(sessionId);
    
    if (!chat) {
      console.warn('Chat session not found for history, sessionId:', sessionId);
      return res.status(404).json({ 
        error: 'Chat session not found' 
      });
    }

    // Get chat history
    const history = await chat.getHistory();
    console.log('Returning chat history for session:', sessionId);
    
    res.json({
      history: history.map((item, index) => ({
        id: index,
        text: item.parts[0].text,
        sender: item.role === 'user' ? 'user' : 'bot',
        timestamp: new Date().toISOString()
      }))
    });

  } catch (error) {
    console.error('Error getting chat history:', error);
    res.status(500).json({ 
      error: 'Failed to get chat history',
      details: error.message 
    });
  }
});

// Clear chat session
app.delete('/api/chat/:sessionId', (req, res) => {
  console.log('[DELETE] /api/chat/' + req.params.sessionId + ' endpoint hit');
  try {
    const { sessionId } = req.params;
    
    if (chatSessions.has(sessionId)) {
      chatSessions.delete(sessionId);
      console.log('Cleared chat session:', sessionId);
      res.json({ message: 'Chat session cleared successfully' });
    } else {
      console.warn('Chat session not found for delete, sessionId:', sessionId);
      res.status(404).json({ error: 'Chat session not found' });
    }
  } catch (error) {
    console.error('Error clearing chat session:', error);
    res.status(500).json({ 
      error: 'Failed to clear chat session',
      details: error.message 
    });
  }
});

// Cleanup old sessions (run every hour)
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [sessionId] of chatSessions) {
    const sessionAge = now - parseInt(sessionId);
    if (sessionAge > oneHour) {
      chatSessions.delete(sessionId);
      console.log(`Cleaned up old session: ${sessionId}`);
    }
  }
}, 60 * 60 * 1000);

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Gemini Fitness Assistant API running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  Warning: GEMINI_API_KEY not found in environment variables');
  } else {
    console.log('✅ Gemini API key loaded successfully');
  }
});

module.exports = app;