const express = require("express");
const router = express.Router();
const ChatLog = require("../models/chatLog.js");
const Listing = require("../models/listing.js");
const User = require("../models/user.js");
const { isLoggedin } = require("../middleware.js");

// Hugging Face Inference API integration
const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
// Default to a broadly accessible model; allow override via env
const HF_MODEL = process.env.HF_MODEL || 'HuggingFaceH4/zephyr-7b-beta';
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;
const HF_MAX_TOKENS = Number(process.env.HF_MAX_TOKENS || 320);
const HF_TEMPERATURE = Number(process.env.HF_TEMPERATURE || 0.7);
const HF_TOP_P = Number(process.env.HF_TOP_P || 0.9);

// Compose a compact conversation context for the model
function buildPrompt(message, user, history = []) {
  const username = user ? user.username : 'Guest';
  const system = `You are Rentify AI, a helpful assistant for the Rentify rental platform.\n\nGoals:\n- Provide accurate, helpful, and concise answers (3-8 sentences).\n- Be friendly and proactive. Offer practical tips for travel, budgeting, safety, and local insights.\n- If platform-specific steps apply, give clear numbered steps.\n- If information is missing, ask a brief clarifying question before assuming.\n- When uncertain, say so and suggest next actions.\n\nPlatform facts:\n- Listings have title, description, location, country, and price per day.\n- Users can browse properties at /listings/allListing.\n- Bookings are made on property pages with Razorpay payments.\n- We cannot access private user account data in this chat.\n\nStyle:\n- Use short paragraphs and bullets.\n- Avoid over-promising.\n- No markdown tables.\n`;

  const fewShot = `User: What is Rentify?\nAssistant: Rentify is a rental property platform where you can browse listings, filter by budget and location, and book securely via Razorpay. I can help you find options or explain how to list your property.\n\nUser: I want a flat in Pune under 10000.\nAssistant: Sure—do you prefer any area in Pune or amenities (parking, AC, Wi‑Fi)? I can also show you budget-friendly studios and 1BHK options.\n`;

  // Build few-shot instruction with last up to 6 messages
  const recent = history.slice(-6).map(m => `${m.type === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  const finalPrompt = `${system}\n${fewShot}\n${recent ? recent + '\n' : ''}User (${username}): ${message}\nAssistant:`;
  return finalPrompt;
}

async function callHuggingFace(prompt, { maxNewTokens = HF_MAX_TOKENS, temperature = HF_TEMPERATURE, topP = HF_TOP_P } = {}) {
  if (!HF_API_KEY) {
    throw new Error('HUGGINGFACE_API_KEY not configured');
  }

  const payload = {
    inputs: prompt,
    parameters: {
      max_new_tokens: maxNewTokens,
      temperature: temperature,
      top_p: topP,
      return_full_text: false,
      truncate: 4096
    }
  };

  // Simple retry on cold start (503) up to 2 times
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(HF_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${HF_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 503) {
      // Model loading
      try {
        const body = await res.json();
        const wait = Math.min(1500 + attempt * 1000, 5000);
        await new Promise(r => setTimeout(r, wait));
        continue;
      } catch (_) {
        await new Promise(r => setTimeout(r, 1200));
        continue;
      }
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HF API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    // Inference API for text-generation often returns array with generated_text
    if (Array.isArray(data) && data.length > 0 && data[0].generated_text) {
      return data[0].generated_text.trim();
    }
    // Some models may return object with generated_text
    if (data && data.generated_text) {
      return data.generated_text.trim();
    }
    // Or conversation-style output
    if (data && data.outputs && typeof data.outputs === 'string') {
      return data.outputs.trim();
    }
    // Fallback: stringify
    return (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 1000);
  }

  throw new Error('HF API retry limit reached');
}

// Generate a session ID for anonymous users
function generateSessionId() {
  return 'session_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// Basic input sanitation and simple safety filter
function sanitizeUserInput(input) {
  if (!input || typeof input !== 'string') return '';
  // Strip excessive whitespace and potential control chars
  let cleaned = input.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  // Very light profanity filter (non-exhaustive)
  const blocked = /(kill|suicide|terror|bomb|nazi)/i;
  if (blocked.test(cleaned)) {
    return 'Please keep the conversation safe and respectful.';
  }
  return cleaned;
}

// Process property-related queries
async function processPropertyQuery(message, userId) {
  const lowerMessage = message.toLowerCase();
  
  // Extract location, price, and property type from the message
  const locations = ['mumbai', 'delhi', 'bangalore', 'pune', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad', 'jaipur', 'nagpur', 'goa', 'kerala', 'rajasthan', 'himachal', 'kashmir', 'akola', 'amravati', 'nashik', 'aurangabad', 'solapur', 'kolhapur', 'sangli', 'satara', 'ratnagiri', 'sindhudurg', 'gadchiroli', 'chandrapur', 'yavatmal', 'washim', 'hingoli', 'nanded', 'parbhani', 'jalna', 'beed', 'latur', 'osmanabad', 'dhule', 'nandurbar', 'jalgaon', 'buldhana', 'akola', 'amravati', 'wardha', 'nagpur', 'bhandara', 'gondia', 'chandrapur', 'gadchiroli', 'yavatmal', 'washim', 'hingoli', 'nanded', 'parbhani', 'jalna', 'beed', 'latur', 'osmanabad'];
  const propertyTypes = ['1bhk', '2bhk', '3bhk', '4bhk', 'studio', 'apartment', 'flat', 'house', 'villa', 'room', 'bedroom', 'penthouse', 'duplex'];
  
  let location = null;
  let price = null;
  let propertyType = null;
  
  // Extract location with better matching
  for (const loc of locations) {
    if (lowerMessage.includes(loc)) {
      location = loc;
      break;
    }
  }
  
  // If no exact match, try to extract city name from "in [city]" pattern
  if (!location) {
    const cityMatch = lowerMessage.match(/in\s+([a-zA-Z\s]+?)(?:\s|$)/);
    if (cityMatch) {
      const cityName = cityMatch[1].trim().toLowerCase();
      console.log('Extracted city name:', cityName);
      // Check if this city exists in our database by searching for it
      const cityExists = await Listing.findOne({
        $or: [
          { location: new RegExp(cityName, 'i') },
          { country: new RegExp(cityName, 'i') }
        ]
      });
      if (cityExists) {
        location = cityName;
        console.log('City found in database:', cityName);
      } else {
        console.log('City not found in database:', cityName);
      }
    }
  }
  
  console.log('Final location detected:', location);
  
  // Extract price with better pattern matching
  const pricePatterns = [
    /₹?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:k|thousand)/i,
    /₹?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:lakh)/i,
    /₹?(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:cr|crore)/i,
    /under\s*₹?(\d+(?:,\d+)*(?:\.\d+)?)/i,
    /below\s*₹?(\d+(?:,\d+)*(?:\.\d+)?)/i,
    /less\s*than\s*₹?(\d+(?:,\d+)*(?:\.\d+)?)/i,
    /₹?(\d+(?:,\d+)*(?:\.\d+)?)\s*per\s*day/i,
    /₹?(\d+(?:,\d+)*(?:\.\d+)?)\s*daily/i
  ];
  
  for (const pattern of pricePatterns) {
    const match = message.match(pattern);
    if (match) {
      let priceValue = parseFloat(match[1].replace(/,/g, ''));
      if (lowerMessage.includes('k') || lowerMessage.includes('thousand')) {
        priceValue *= 1000;
      } else if (lowerMessage.includes('lakh')) {
        priceValue *= 100000;
      } else if (lowerMessage.includes('cr') || lowerMessage.includes('crore')) {
        priceValue *= 10000000;
      }
      price = priceValue;
      break;
    }
  }
  
  // Extract property type
  for (const type of propertyTypes) {
    if (lowerMessage.includes(type)) {
      propertyType = type;
      break;
    }
  }
  
  // Build MongoDB query
  const query = {};
  
  // Always require location if specified
  if (location) {
    query.$or = [
      { location: new RegExp(location, 'i') },
      { country: new RegExp(location, 'i') }
    ];
  } else {
    // If no location, craft a helpful clarifying question using LLM, fallback to static
    try {
      const prompt = buildPrompt('The user asked: ' + message + '\nThey did not specify a city. Ask a brief clarifying question to get the city and optionally budget/type.', null, []);
      const llmQ = await callHuggingFace(prompt, { maxNewTokens: 80, temperature: 0.5, topP: HF_TOP_P });
      return llmQ || `Which city would you like to search in? You can also share your budget and property type (e.g., 2BHK under ₹10,000 in Pune).`;
    } catch (_) {
      return `Which city would you like to search in? You can also share your budget and property type (e.g., 2BHK under ₹10,000 in Pune).`;
    }
  }
  
  if (price) {
    query.price = { $lte: price };
  }
  if (propertyType) {
    const typeQuery = [
      { title: new RegExp(propertyType, 'i') },
      { description: new RegExp(propertyType, 'i') }
    ];
    if (query.$or) {
      query.$and = [
        { $or: query.$or },
        { $or: typeQuery }
      ];
      delete query.$or;
    } else {
      query.$or = typeQuery;
    }
  }
  
  // Search for matching properties
  const properties = await Listing.find(query).limit(5).populate('owner');
  
  if (properties.length > 0) {
    // Summarize with LLM for a more natural, helpful answer; fallback to static list
    try {
      const items = properties.map((p, i) => `${i + 1}. ${p.title} | ${p.location}, ${p.country} | ₹${p.price}/day | Host: ${p.owner?.username || 'N/A'} | ${p.description ? p.description.slice(0, 120) : ''}`).join('\n');
      const prompt = buildPrompt(`Summarize and recommend from these properties for the user's query. Return a concise helpful answer with bullets and tips.\n\n${items}\n\nAlso suggest using /listings/allListing for more.`, null, []);
      const llmSummary = await callHuggingFace(prompt, { maxNewTokens: 200, temperature: HF_TEMPERATURE, topP: HF_TOP_P });
      if (llmSummary) return llmSummary + `\n\n🔗 Browse more: /listings/allListing`;
    } catch (_) { /* ignore and fallback */ }

    let response = `I found ${properties.length} property(ies) matching your criteria:\n\n`;
    properties.forEach((property, index) => {
      response += `${index + 1}. **${property.title}**\n`;
      response += `   📍 ${property.location}, ${property.country}\n`;
      response += `   💰 ₹${property.price.toLocaleString()} per day\n`;
      response += `   👤 Host: ${property.owner.username}\n`;
      if (property.description && property.description.length > 50) {
        response += `   📝 ${property.description.substring(0, 50)}...\n`;
      }
      response += `\n`;
    });
    response += `🔗 View all properties: /listings/allListing\n`;
    response += `💡 Tip: You can filter by price, location, and amenities on our search page!`;
    return response;
  } else {
    let response = `I couldn't find any properties matching your criteria. `;
    
    if (location) {
      response += `Unfortunately, there are currently no properties available in ${location.charAt(0).toUpperCase() + location.slice(1)}. `;
    }
    if (price) {
      response += `Try increasing your budget or searching without price filters. `;
    }
    if (propertyType) {
      response += `Try searching for different property types. `;
    }
    
    response += `\n\n💡 **Suggestions:**\n`;
    response += `• Check other popular cities like Delhi, Bangalore, Pune\n`;
    response += `• Browse all available properties: /listings/allListing\n`;
    response += `• Try different search terms or remove filters\n`;
    response += `• Contact us if you're looking for something specific\n\n`;
    response += `🔗 **Browse all properties:** /listings/allListing`;
    
    return response;
  }
}

// Generate context-aware greeting
function generateGreeting(user) {
  if (user) {
    return `Welcome back, ${user.username}! 👋 I'm Rentify AI, your property assistant. How can I help you today?`;
  }
  return `Hello! 👋 I'm Rentify AI, your property assistant. I can help you find properties, answer questions about rentals, or guide you through our platform. What would you like to know?`;
}

// Process general queries
async function processGeneralQuery(message, user) {
  const lowerMessage = message.toLowerCase();
  const seasonalIntent = /best time|what'?s the best time|when (?:is|to)\s+(?:go|visit|travel|book)|season|peak season|off season|monsoon|summer|winter/.test(lowerMessage);
  const smallTalkIntent = /how are you|how'?s it going|what'?s up|how do you do/.test(lowerMessage);
  
  // Property listing help
  if ((lowerMessage.includes('list') || lowerMessage.includes('listing') || lowerMessage.includes('add property') || lowerMessage.includes('post property')) && 
      (lowerMessage.includes('property') || lowerMessage.includes('home') || lowerMessage.includes('house') || 
       lowerMessage.includes('how can i') || lowerMessage.includes('how to') || lowerMessage.includes('can i'))) {
    return `To list your property on Rentify:\n\n1. Click "List Your Property" on the homepage\n2. Fill in property details (title, description, price, location)\n3. Upload up to 3 photos\n4. Add amenities and features\n5. Submit for review\n\nYour property will be live once approved! Need help with any step?`;
  }
  
  // How to book/rent (avoid seasonal/time queries)
  if (!seasonalIntent && (lowerMessage.includes('how to book') || (lowerMessage.includes('book') && !lowerMessage.includes('best time') && !lowerMessage.includes('when')) || lowerMessage.includes('rent'))) {
    return `To book a property on Rentify:\n\n1. Browse properties on our homepage\n2. Click on a property you like\n3. Select your check-in and check-out dates\n4. Choose number of guests\n5. Click "Book Now" and proceed to payment\n6. Complete payment via Razorpay\n\nYou'll receive a confirmation and receipt! Need help with any step?`;
  }
  
  // Rental terms
  if (lowerMessage.includes('rental') || lowerMessage.includes('term') || lowerMessage.includes('policy') || lowerMessage.includes('cancellation')) {
    return `Our rental terms include:\n\n• Minimum 1-day booking\n• 18% GST included in final price\n• Secure payment via Razorpay\n• Free cancellation up to 24 hours before check-in\n• 24/7 customer support\n\nFor detailed terms, visit our help center or contact support.`;
  }
  
  // Pricing information
  if (lowerMessage.includes('price') || lowerMessage.includes('cost') || lowerMessage.includes('charge') || lowerMessage.includes('fee')) {
    return `Rentify pricing:\n\n• Property owners: Free to list\n• Guests: Property price + 18% GST\n• Payment processing: Secure Razorpay integration\n• No hidden fees\n\nAll prices are displayed per day. Want to see available properties?`;
  }
  
  // Payment methods
  if (lowerMessage.includes('payment') || lowerMessage.includes('pay') || lowerMessage.includes('razorpay')) {
    return `We accept secure payments through Razorpay:\n\n• Credit/Debit Cards\n• Net Banking\n• UPI\n• Wallets\n• EMI options available\n\nAll transactions are secure and encrypted. You'll receive a receipt after payment.`;
  }
  
  // Account/profile help
  if (lowerMessage.includes('account') || lowerMessage.includes('profile') || lowerMessage.includes('login') || lowerMessage.includes('signup')) {
    return `Account help:\n\n• Sign up: Click "Sign Up" in the top right\n• Login: Use your username/email and password\n• Profile: Click on your name to access your profile\n• My Bookings: View all your bookings\n• My Listings: Manage your properties\n\nNeed help with account setup?`;
  }
  
  // Support contact
  if (lowerMessage.includes('support') || lowerMessage.includes('help') || lowerMessage.includes('contact') || lowerMessage.includes('problem') || lowerMessage.includes('issue')) {
    return `Need help? Here's how to reach us:\n\n📧 Email: support@rentify.com\n📞 Phone: +91-95292-57473\n💬 Live Chat: Available 24/7\n📖 Help Center: /help\n\nI'm here to assist you right now! What do you need help with?`;
  }
  
  // What can you do
  if (lowerMessage.includes('what can you do') || lowerMessage.includes('what do you do') || lowerMessage.includes('capabilities')) {
    return `I can help you with:\n\n🔍 **Find Properties**: Search by location, price, type\n📝 **List Properties**: Guide you through listing process\n💰 **Pricing Info**: Explain costs and payment methods\n📋 **Booking Help**: Assist with reservations\n❓ **General Support**: Answer platform questions\n\nWhat would you like to know?`;
  }
  
  // Default response
  return `I'm not sure about that. Would you like me to connect you with Rentify Support? Or I can help you:\n\n• Find properties by location and budget\n• Explain how to list your property\n• Answer questions about rental terms\n• Guide you through our platform\n\nWhat would you like to know?`;
}

// Main chat endpoint
router.post("/", async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    const userId = req.user ? req.user._id : null;
    const safeMessage = sanitizeUserInput(message);
    
    if (!safeMessage || !safeMessage.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }
    
    // Generate session ID if not provided
    const currentSessionId = sessionId || generateSessionId();
    
    // Find or create chat log
    let chatLog = await ChatLog.findOne({ 
      sessionId: currentSessionId,
      ...(userId ? { user: userId } : { user: { $exists: false } })
    });
    
    if (!chatLog) {
      chatLog = new ChatLog({
        user: userId,
        sessionId: currentSessionId,
        messages: []
      });
    }
    
    // Add user message
    chatLog.messages.push({
      type: "user",
      content: safeMessage.trim()
    });
    
    // Process the message and generate response
    let botResponse;
    const lowerMessage = safeMessage.toLowerCase();
    
    // Debug logging
    console.log('Processing message:', message);
    console.log('Lower message:', lowerMessage);
    
    // Check if it's a greeting or small-talk
    if ((lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey') || lowerMessage.includes('good morning') || lowerMessage.includes('good afternoon') || lowerMessage.includes('good evening') || lowerMessage.includes('how are you'))) {
      console.log('Classified as: Greeting/Small-talk');
      // Prefer LLM for natural small-talk, fallback to static greeting
      try {
        const prompt = buildPrompt(message, req.user, chatLog.messages || []);
        const llm = await callHuggingFace(prompt, { maxNewTokens: 120, temperature: 0.6, topP: 0.9 });
        botResponse = llm || generateGreeting(req.user);
      } catch (_) {
        botResponse = generateGreeting(req.user);
      }
    }
    // Check if it's a property search query (only if it's actually searching for properties)
    else if ((lowerMessage.includes('show me') || lowerMessage.includes('find me') || lowerMessage.includes('search for') || 
             lowerMessage.includes('i want to see') || lowerMessage.includes('i need') || lowerMessage.includes('looking for') ||
             lowerMessage.includes('show') || lowerMessage.includes('find') || lowerMessage.includes('search')) && 
             (lowerMessage.includes('property') || lowerMessage.includes('properties') || lowerMessage.includes('flat') || 
             lowerMessage.includes('apartment') || lowerMessage.includes('room') || lowerMessage.includes('house') || 
             lowerMessage.includes('rent') || lowerMessage.includes('bhk') || lowerMessage.includes('bedroom') || 
             lowerMessage.includes('available') || lowerMessage.includes('under') || lowerMessage.includes('budget') || 
             lowerMessage.includes('price') || lowerMessage.includes('in ') || lowerMessage.includes('at '))) {
      console.log('Classified as: Property Search');
      botResponse = await processPropertyQuery(safeMessage, userId);
    }
    // Process general queries (including help questions)
    else {
      console.log('Classified as: General Query');
      // Route seasonal/time/location guidance straight to LLM for richer context
      const isSeasonal = /best time|what'?s the best time|when (?:is|to)\s+(?:go|visit|travel|book)|season|peak season|off season|monsoon|summer|winter/.test(lowerMessage);
      if (isSeasonal) {
        try {
          const prompt = buildPrompt(safeMessage, req.user, chatLog.messages || []);
          const llm = await callHuggingFace(prompt, { maxNewTokens: 220, temperature: 0.7, topP: 0.9 });
          botResponse = llm || await processGeneralQuery(message, req.user);
        } catch (e) {
          console.warn('LLM seasonal fallback:', e.message);
          botResponse = await processGeneralQuery(safeMessage, req.user);
        }
      } else {
        // Try LLM first for richer answers; fall back to rule-based helper
        try {
          const prompt = buildPrompt(safeMessage, req.user, chatLog.messages || []);
          const llm = await callHuggingFace(prompt, { maxNewTokens: 300, temperature: 0.7, topP: 0.9 });
          botResponse = llm || await processGeneralQuery(safeMessage, req.user);
        } catch (e) {
          console.warn('LLM fallback due to error or missing key:', e.message);
          botResponse = await processGeneralQuery(safeMessage, req.user);
        }
      }
    }
    
    // Add bot response
    chatLog.messages.push({
      type: "bot",
      content: botResponse
    });
    
    // Keep only last 10 messages to prevent document from growing too large
    if (chatLog.messages.length > 10) {
      chatLog.messages = chatLog.messages.slice(-10);
    }
    
    // Save chat log
    await chatLog.save();
    
    res.json({
      success: true,
      response: botResponse,
      sessionId: currentSessionId,
      messageCount: chatLog.messages.length
    });
    
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ 
      error: "Sorry, I'm having trouble processing your request. Please try again." 
    });
  }
});

// Get chat history
router.get("/history/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user ? req.user._id : null;
    
    const chatLog = await ChatLog.findOne({ 
      sessionId: sessionId,
      ...(userId ? { user: userId } : { user: { $exists: false } })
    });
    
    if (!chatLog) {
      return res.json({ messages: [] });
    }
    
    res.json({ 
      messages: chatLog.messages,
      sessionId: sessionId
    });
    
  } catch (error) {
    console.error("Get history error:", error);
    res.status(500).json({ error: "Failed to retrieve chat history" });
  }
});

module.exports = router;
