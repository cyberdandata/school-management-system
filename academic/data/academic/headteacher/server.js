// ==================== HEAD TEACHER DASHBOARD - server.js ====================
// Port: 5000
// Complete dashboard for Director/Head Teacher - Fetches data from Financial System

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const http = require('http');

const app = express();
const PORT = process.env.HEADTEACHER_PORT || 5000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== PATHS ====================
const dataDir = path.join(__dirname, 'data');

// Ensure directories exist
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ==================== FINANCIAL SYSTEM PROXY ====================
const FINANCIAL_SYSTEM_URL = process.env.FINANCIAL_URL || 'http://localhost:3000';

// Proxy function to fetch from financial system
async function fetchFromFinancial(endpoint) {
    try {
        const response = await fetch(`${FINANCIAL_SYSTEM_URL}${endpoint}`, {
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });
        if (response.ok) {
            return await response.json();
        }
        console.error(`Financial system returned ${response.status} for ${endpoint}`);
        return null;
    } catch (error) {
        console.error(`Error fetching from financial system: ${error.message}`);
        return null;
    }
}

// ==================== AUTHENTICATION ====================
const ADMIN_CREDENTIALS = {
    username: 'admin',
    password: 'admin123',
    role: 'headteacher'
};

app.post('/api/head/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        const token = uuidv4();
        const sessions = readFile(path.join(dataDir, 'sessions.json'), {});
        sessions[token] = {
            username,
            role: 'headteacher',
            loginTime: new Date().toISOString()
        };
        saveFile(path.join(dataDir, 'sessions.json'), sessions);
        
        res.json({
            success: true,
            token,
            user: {
                username: ADMIN_CREDENTIALS.username,
                role: 'headteacher'
            }
        });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.post('/api/head/verify', (req, res) => {
    const { token } = req.body;
    const sessions = readFile(path.join(dataDir, 'sessions.json'), {});
    const session = sessions[token];
    if (!session) return res.status(401).json({ error: 'Invalid session' });
    res.json({ success: true, user: session });
});

app.post('/api/head/logout', (req, res) => {
    const { token } = req.body;
    const sessions = readFile(path.join(dataDir, 'sessions.json'), {});
    delete sessions[token];
    saveFile(path.join(dataDir, 'sessions.json'), sessions);
    res.json({ success: true });
});

// ==================== READ/WRITE HELPERS ====================
function readFile(filePath, defaultData) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        }
        return defaultData || (Array.isArray(defaultData) ? [] : {});
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return defaultData || (Array.isArray(defaultData) ? [] : {});
    }
}

function saveFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
}

// ==================== DASHBOARD - FETCH FROM FINANCIAL SYSTEM ====================
app.get('/api/head/dashboard', async (req, res) => {
    try {
        // Try to fetch from financial system first
        let dashboardData = await fetchFromFinancial('/api/dashboard/stats');
        
        if (dashboardData && dashboardData.success) {
            // Add school info from financial system
            const schoolData = await fetchFromFinancial('/api/school');
            if (schoolData && schoolData.school) {
                dashboardData.data.school = schoolData.school;
            }
            
            // Cache the data locally
            saveFile(path.join(dataDir, 'dashboardCache.json'), dashboardData);
            
            return res.json(dashboardData);
        }
        
        // Fallback to cached data
        const cached = readFile(path.join(dataDir, 'dashboardCache.json'), null);
        if (cached) {
            return res.json(cached);
        }
        
        return res.status(503).json({ 
            success: false, 
            error: 'Financial system unavailable and no cached data available' 
        });
    } catch (error) {
        console.error('Error fetching dashboard:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== GET CACHED DASHBOARD ====================
app.get('/api/head/dashboard/cached', (req, res) => {
    const cached = readFile(path.join(dataDir, 'dashboardCache.json'), null);
    if (cached) {
        res.json(cached);
    } else {
        res.status(404).json({ error: 'No cached data available' });
    }
});

// ==================== PROXY ROUTES TO FINANCIAL SYSTEM ====================
// Proxy all financial system routes that the dashboard needs

// School info
app.get('/api/school', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/school');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Students
app.get('/api/students', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/students');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Classes
app.get('/api/school/classes', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/school/classes');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fee structures
app.get('/api/fee/structures', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/fee/structures');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fee payments
app.get('/api/fee/payments', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/fee/payments');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fee bursaries
app.get('/api/fee/bursaries', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/fee/bursaries');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Student fee assignments
app.get('/api/student-fee-assignments', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/student-fee-assignments');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Inventory stock
app.get('/api/inventory/stock', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/inventory/stock');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Uniform stock
app.get('/api/uniform/stock', async (req, res) => {
    try {
        const data = await fetchFromFinancial('/api/uniform/stock');
        if (data) return res.json(data);
        res.status(503).json({ error: 'Financial system unavailable' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== HEAD TEACHER SPECIFIC ROUTES ====================
// Announcements (stored locally)
app.get('/api/head/announcements', (req, res) => {
    const announcements = readFile(path.join(dataDir, 'announcements.json'), []);
    res.json(announcements);
});

app.post('/api/head/announcements', (req, res) => {
    const { title, content, type, priority } = req.body;
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content required' });
    }
    const announcements = readFile(path.join(dataDir, 'announcements.json'), []);
    const newAnnouncement = {
        id: uuidv4(),
        title,
        content,
        type: type || 'general',
        priority: priority || 'normal',
        createdAt: new Date().toISOString(),
        isActive: true
    };
    announcements.unshift(newAnnouncement);
    saveFile(path.join(dataDir, 'announcements.json'), announcements);
    res.json({ success: true, announcement: newAnnouncement });
});

app.put('/api/head/announcements/:id', (req, res) => {
    const { id } = req.params;
    const { title, content, type, priority, isActive } = req.body;
    let announcements = readFile(path.join(dataDir, 'announcements.json'), []);
    const index = announcements.findIndex(a => a.id === id);
    if (index === -1) return res.status(404).json({ error: 'Announcement not found' });
    announcements[index] = {
        ...announcements[index],
        title: title || announcements[index].title,
        content: content || announcements[index].content,
        type: type || announcements[index].type,
        priority: priority || announcements[index].priority,
        isActive: isActive !== undefined ? isActive : announcements[index].isActive,
        updatedAt: new Date().toISOString()
    };
    saveFile(path.join(dataDir, 'announcements.json'), announcements);
    res.json({ success: true, announcement: announcements[index] });
});

app.delete('/api/head/announcements/:id', (req, res) => {
    const { id } = req.params;
    let announcements = readFile(path.join(dataDir, 'announcements.json'), []);
    announcements = announcements.filter(a => a.id !== id);
    saveFile(path.join(dataDir, 'announcements.json'), announcements);
    res.json({ success: true });
});

// ==================== HELPER FUNCTIONS ====================
function getTermName(term) {
    const names = { 1: 'First Term', 2: 'Second Term', 3: 'Third Term' };
    return names[term] || `Term ${term}`;
}

// ==================== FRONTEND ROUTE ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('👔 HEAD TEACHER DASHBOARD v2.0');
    console.log('='.repeat(60));
    console.log(`✅ Server running at: http://localhost:${PORT}`);
    console.log(`🔗 Connected to Financial System: ${FINANCIAL_SYSTEM_URL}`);
    console.log('='.repeat(60));
    console.log('📊 Dashboard Features:');
    console.log('   - Complete Financial Dashboard (from Financial System)');
    console.log('   - Student Statistics');
    console.log('   - Fee Collection Overview');
    console.log('   - Inventory Summary');
    console.log('   - Uniform Management');
    console.log('   - Announcements');
    console.log('='.repeat(60));
    console.log('🔑 Login: admin / admin123');
    console.log('='.repeat(60));
});