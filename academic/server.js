// ==================== ACADEMIC SYSTEM - server.js ====================
// Complete Academic Management System
// Version: 1.0 - Fully Integrated with Main System

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.ACADEMIC_PORT || 4000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==================== FILE PATHS ====================
const dataDir = path.join(__dirname, 'data');
const academicDir = path.join(dataDir, 'academic');

// Ensure directories exist
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(academicDir)) fs.mkdirSync(academicDir, { recursive: true });

// Academic data files
const academicFiles = {
    teachers: path.join(academicDir, 'teachers.json'),
    classAssignments: path.join(academicDir, 'classAssignments.json'),
    timetables: path.join(academicDir, 'timetables.json'),
    sweepingRosters: path.join(academicDir, 'sweepingRosters.json'),
    reportCards: path.join(academicDir, 'reportCards.json'),
    gradingScales: path.join(academicDir, 'gradingScales.json'),
    reportTemplates: path.join(academicDir, 'reportTemplates.json'),
    studentProgress: path.join(academicDir, 'studentProgress.json'),
    terms: path.join(academicDir, 'terms.json'),
    teacherSessions: path.join(academicDir, 'teacherSessions.json')
};

// ==================== READ/WRITE HELPERS ====================
function readFile(filePath, defaultData) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        }
        return defaultData || (filePath.includes('teachers') || filePath.includes('timetables') || 
                              filePath.includes('sweepingRosters') || filePath.includes('reportCards') || 
                              filePath.includes('studentProgress') ? [] : {});
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return defaultData || (filePath.includes('teachers') || filePath.includes('timetables') || 
                              filePath.includes('sweepingRosters') || filePath.includes('reportCards') || 
                              filePath.includes('studentProgress') ? [] : {});
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

// ==================== INITIALIZE DATA ====================
function initializeAcademicData() {
    // Initialize teachers
    if (!fs.existsSync(academicFiles.teachers)) {
        saveFile(academicFiles.teachers, []);
    }
    
    // Initialize class assignments
    if (!fs.existsSync(academicFiles.classAssignments)) {
        saveFile(academicFiles.classAssignments, []);
    }
    
    // Initialize timetables
    if (!fs.existsSync(academicFiles.timetables)) {
        saveFile(academicFiles.timetables, []);
    }
    
    // Initialize sweeping rosters
    if (!fs.existsSync(academicFiles.sweepingRosters)) {
        saveFile(academicFiles.sweepingRosters, []);
    }
    
    // Initialize report cards
    if (!fs.existsSync(academicFiles.reportCards)) {
        saveFile(academicFiles.reportCards, []);
    }
    
    // Initialize grading scales
    if (!fs.existsSync(academicFiles.gradingScales)) {
        saveFile(academicFiles.gradingScales, {
            default: {
                'A': { min: 80, max: 100, grade: 'A', description: 'Excellent', points: 1 },
                'B': { min: 70, max: 79, grade: 'B', description: 'Very Good', points: 2 },
                'C': { min: 60, max: 69, grade: 'C', description: 'Good', points: 3 },
                'D': { min: 50, max: 59, grade: 'D', description: 'Satisfactory', points: 4 },
                'E': { min: 40, max: 49, grade: 'E', description: 'Fair', points: 5 },
                'F': { min: 0, max: 39, grade: 'F', description: 'Poor', points: 6 }
            }
        });
    }
    
    // Initialize report templates
    if (!fs.existsSync(academicFiles.reportTemplates)) {
        saveFile(academicFiles.reportTemplates, {
            default: {
                id: 'default',
                name: 'Standard Report Card',
                header: {
                    schoolName: '{{schoolName}}',
                    title: 'ACADEMIC REPORT CARD',
                    term: '{{term}} {{year}}',
                    studentInfo: ['Student Name: {{studentName}}', 'Admission: {{admissionNumber}}', 'Class: {{className}}']
                },
                subjects: {
                    show: true,
                    columns: ['Subject', 'Score', 'Grade', 'Remark']
                },
                summary: {
                    show: true,
                    fields: ['Average', 'Grade', 'Position', 'Total']
                },
                footer: {
                    teacherComment: true,
                    recommendation: true,
                    signature: true
                },
                layout: 'standard'
            }
        });
    }
    
    // Initialize terms
    if (!fs.existsSync(academicFiles.terms)) {
        const currentYear = new Date().getFullYear();
        saveFile(academicFiles.terms, {
            currentYear: currentYear,
            currentTerm: 1,
            terms: {
                [currentYear]: {
                    1: { name: 'First Term', start: `${currentYear}-01-10`, end: `${currentYear}-04-10`, isActive: true },
                    2: { name: 'Second Term', start: `${currentYear}-05-10`, end: `${currentYear}-08-10`, isActive: false },
                    3: { name: 'Third Term', start: `${currentYear}-09-10`, end: `${currentYear}-12-10`, isActive: false }
                }
            }
        });
    }
    
    // Initialize student progress
    if (!fs.existsSync(academicFiles.studentProgress)) {
        saveFile(academicFiles.studentProgress, []);
    }
    
    // Initialize teacher sessions
    if (!fs.existsSync(academicFiles.teacherSessions)) {
        saveFile(academicFiles.teacherSessions, {});
    }
    
    console.log('✅ Academic data initialized');
}

initializeAcademicData();

// ==================== INTEGRATION WITH MAIN SYSTEM ====================
// Helper to fetch data from main system
async function fetchFromMainSystem(endpoint) {
    try {
        const response = await fetch(`http://localhost:3000${endpoint}`);
        if (response.ok) return await response.json();
        return null;
    } catch (error) {
        console.error('Error fetching from main system:', error);
        return null;
    }
}

// Sync students from main system
async function syncStudentsFromMainSystem() {
    try {
        const students = await fetchFromMainSystem('/api/students');
        if (students) {
            // Store students in academic system for offline access
            const academicStudents = students.map(s => ({
                id: s.id,
                admissionNumber: s.admissionNumber,
                firstName: s.firstName,
                lastName: s.lastName,
                gender: s.gender,
                currentClassId: s.currentClassId,
                currentClass: s.currentClass,
                parentInfo: s.parentInfo,
                status: s.status,
                enrolledAt: s.enrolledAt
            }));
            
            // Save to academic data
            saveFile(path.join(academicDir, 'students.json'), academicStudents);
            return academicStudents;
        }
        // Fallback to local cache
        return readFile(path.join(academicDir, 'students.json'), []);
    } catch (error) {
        console.error('Error syncing students:', error);
        return readFile(path.join(academicDir, 'students.json'), []);
    }
}

// Sync classes from main system
async function syncClassesFromMainSystem() {
    try {
        const classes = await fetchFromMainSystem('/api/school/classes');
        if (classes) {
            saveFile(path.join(academicDir, 'classes.json'), classes);
            return classes;
        }
        return readFile(path.join(academicDir, 'classes.json'), []);
    } catch (error) {
        console.error('Error syncing classes:', error);
        return readFile(path.join(academicDir, 'classes.json'), []);
    }
}

// Sync subjects from main system
async function syncSubjectsFromMainSystem() {
    try {
        const subjects = await fetchFromMainSystem('/api/school/subjects');
        if (subjects) {
            saveFile(path.join(academicDir, 'subjects.json'), subjects);
            return subjects;
        }
        return readFile(path.join(academicDir, 'subjects.json'), []);
    } catch (error) {
        console.error('Error syncing subjects:', error);
        return readFile(path.join(academicDir, 'subjects.json'), []);
    }
}

// ==================== TEACHER AUTHENTICATION ====================
// Teacher login
app.post('/api/academic/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    const teachers = readFile(academicFiles.teachers, []);
    const teacher = teachers.find(t => 
        t.username === username && 
        (t.password === password || (t.tempPassword && t.tempPassword === password))
    );
    
    if (!teacher) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Create session
    const token = uuidv4();
    const sessions = readFile(academicFiles.teacherSessions, {});
    sessions[token] = {
        teacherId: teacher.id,
        username: teacher.username,
        firstName: teacher.firstName,
        lastName: teacher.lastName,
        classId: teacher.classId,
        className: teacher.className,
        createdAt: new Date().toISOString()
    };
    saveFile(academicFiles.teacherSessions, sessions);
    
    // If using temp password, prompt to change
    const needPasswordChange = teacher.tempPassword === password;
    
    res.json({
        success: true,
        token: token,
        teacher: {
            id: teacher.id,
            username: teacher.username,
            firstName: teacher.firstName,
            lastName: teacher.lastName,
            classId: teacher.classId,
            className: teacher.className,
            needPasswordChange: needPasswordChange
        }
    });
});

// Verify token
app.post('/api/academic/verify', (req, res) => {
    const { token } = req.body;
    const sessions = readFile(academicFiles.teacherSessions, {});
    const session = sessions[token];
    
    if (!session) {
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    res.json({
        success: true,
        teacher: session
    });
});

// Change password
app.post('/api/academic/change-password', (req, res) => {
    const { token, currentPassword, newPassword } = req.body;
    
    const sessions = readFile(academicFiles.teacherSessions, {});
    const session = sessions[token];
    
    if (!session) {
        return res.status(401).json({ error: 'Invalid session' });
    }
    
    const teachers = readFile(academicFiles.teachers, []);
    const teacherIndex = teachers.findIndex(t => t.id === session.teacherId);
    
    if (teacherIndex === -1) {
        return res.status(404).json({ error: 'Teacher not found' });
    }
    
    const teacher = teachers[teacherIndex];
    
    // Verify current password
    if (teacher.password && teacher.password !== currentPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    // Update password
    teachers[teacherIndex] = {
        ...teacher,
        password: newPassword,
        tempPassword: null,
        passwordChangedAt: new Date().toISOString()
    };
    
    saveFile(academicFiles.teachers, teachers);
    
    res.json({ success: true, message: 'Password changed successfully' });
});

// Logout
app.post('/api/academic/logout', (req, res) => {
    const { token } = req.body;
    const sessions = readFile(academicFiles.teacherSessions, {});
    delete sessions[token];
    saveFile(academicFiles.teacherSessions, sessions);
    res.json({ success: true });
});

// ==================== TEACHER MANAGEMENT (Admin) ====================
// Get all teachers
app.get('/api/academic/teachers', (req, res) => {
    const teachers = readFile(academicFiles.teachers, []);
    res.json(teachers);
});

// Get teacher by ID
app.get('/api/academic/teachers/:id', (req, res) => {
    const teachers = readFile(academicFiles.teachers, []);
    const teacher = teachers.find(t => t.id === req.params.id);
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    res.json(teacher);
});

// Create teacher (Admin only)
app.post('/api/academic/teachers', async (req, res) => {
    const { firstName, lastName, email, phone, classId, className, username, tempPassword } = req.body;
    
    if (!firstName || !lastName || !username || !tempPassword || !classId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const teachers = readFile(academicFiles.teachers, []);
    
    // Check if username exists
    if (teachers.find(t => t.username === username)) {
        return res.status(400).json({ error: 'Username already exists' });
    }
    
    const newTeacher = {
        id: uuidv4(),
        firstName,
        lastName,
        email: email || '',
        phone: phone || '',
        classId,
        className: className || '',
        username,
        password: tempPassword,
        tempPassword: tempPassword,
        isActive: true,
        createdAt: new Date().toISOString()
    };
    
    teachers.push(newTeacher);
    saveFile(academicFiles.teachers, teachers);
    
    // Also update class assignment
    const assignments = readFile(academicFiles.classAssignments, []);
    assignments.push({
        id: uuidv4(),
        teacherId: newTeacher.id,
        classId: classId,
        className: className || '',
        assignedAt: new Date().toISOString(),
        isActive: true
    });
    saveFile(academicFiles.classAssignments, assignments);
    
    res.json({ success: true, teacher: newTeacher });
});

// Update teacher
app.put('/api/academic/teachers/:id', (req, res) => {
    const teachers = readFile(academicFiles.teachers, []);
    const index = teachers.findIndex(t => t.id === req.params.id);
    
    if (index === -1) {
        return res.status(404).json({ error: 'Teacher not found' });
    }
    
    teachers[index] = {
        ...teachers[index],
        ...req.body,
        updatedAt: new Date().toISOString()
    };
    
    saveFile(academicFiles.teachers, teachers);
    res.json({ success: true, teacher: teachers[index] });
});

// Delete teacher
app.delete('/api/academic/teachers/:id', (req, res) => {
    let teachers = readFile(academicFiles.teachers, []);
    teachers = teachers.filter(t => t.id !== req.params.id);
    saveFile(academicFiles.teachers, teachers);
    
    // Also remove assignments
    let assignments = readFile(academicFiles.classAssignments, []);
    assignments = assignments.filter(a => a.teacherId !== req.params.id);
    saveFile(academicFiles.classAssignments, assignments);
    
    res.json({ success: true });
});

// ==================== CLASS ASSIGNMENTS ====================
// Get all class assignments
app.get('/api/academic/class-assignments', (req, res) => {
    const assignments = readFile(academicFiles.classAssignments, []);
    res.json(assignments);
});

// Assign teacher to class
app.post('/api/academic/class-assignments', (req, res) => {
    const { teacherId, classId, className } = req.body;
    
    if (!teacherId || !classId) {
        return res.status(400).json({ error: 'Teacher ID and Class ID required' });
    }
    
    const assignments = readFile(academicFiles.classAssignments, []);
    
    // Deactivate existing assignments for this teacher
    assignments.forEach(a => {
        if (a.teacherId === teacherId) a.isActive = false;
    });
    
    assignments.push({
        id: uuidv4(),
        teacherId,
        classId,
        className: className || '',
        assignedAt: new Date().toISOString(),
        isActive: true
    });
    
    saveFile(academicFiles.classAssignments, assignments);
    res.json({ success: true });
});

// Get teacher's class
app.get('/api/academic/teacher-class/:teacherId', (req, res) => {
    const assignments = readFile(academicFiles.classAssignments, []);
    const active = assignments.find(a => a.teacherId === req.params.teacherId && a.isActive);
    
    if (!active) {
        return res.status(404).json({ error: 'No active class assignment found' });
    }
    
    res.json(active);
});

// ==================== TIMETABLE MANAGEMENT ====================
// Get timetable for a class
app.get('/api/academic/timetable/:classId/:term/:year', (req, res) => {
    const { classId, term, year } = req.params;
    const timetables = readFile(academicFiles.timetables, []);
    
    const timetable = timetables.find(t => 
        t.classId === classId && 
        t.term === parseInt(term) && 
        t.year === parseInt(year)
    );
    
    res.json(timetable || { classId, term: parseInt(term), year: parseInt(year), days: {} });
});

// Save timetable
app.post('/api/academic/timetable', (req, res) => {
    const { classId, term, year, days } = req.body;
    
    if (!classId || !term || !year || !days) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    let timetables = readFile(academicFiles.timetables, []);
    
    const index = timetables.findIndex(t => 
        t.classId === classId && 
        t.term === term && 
        t.year === year
    );
    
    const timetable = {
        classId,
        term,
        year,
        days,
        updatedAt: new Date().toISOString()
    };
    
    if (index !== -1) {
        timetables[index] = { ...timetables[index], ...timetable };
    } else {
        timetables.push({
            id: uuidv4(),
            ...timetable,
            createdAt: new Date().toISOString()
        });
    }
    
    saveFile(academicFiles.timetables, timetables);
    res.json({ success: true });
});

// ==================== SWEEPING ROSTER MANAGEMENT ====================
// Get sweeping roster for a class
app.get('/api/academic/sweeping-roster/:classId/:term/:year', (req, res) => {
    const { classId, term, year } = req.params;
    const rosters = readFile(academicFiles.sweepingRosters, []);
    
    const roster = rosters.find(r => 
        r.classId === classId && 
        r.term === parseInt(term) && 
        r.year === parseInt(year)
    );
    
    res.json(roster || { classId, term: parseInt(term), year: parseInt(year), groups: [] });
});

// Save sweeping roster
app.post('/api/academic/sweeping-roster', (req, res) => {
    const { classId, term, year, groups } = req.body;
    
    if (!classId || !term || !year || !groups) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    let rosters = readFile(academicFiles.sweepingRosters, []);
    
    const index = rosters.findIndex(r => 
        r.classId === classId && 
        r.term === term && 
        r.year === year
    );
    
    const roster = {
        classId,
        term,
        year,
        groups,
        updatedAt: new Date().toISOString()
    };
    
    if (index !== -1) {
        rosters[index] = { ...rosters[index], ...roster };
    } else {
        rosters.push({
            id: uuidv4(),
            ...roster,
            createdAt: new Date().toISOString()
        });
    }
    
    saveFile(academicFiles.sweepingRosters, rosters);
    res.json({ success: true });
});

// ==================== GRADING SCALE MANAGEMENT ====================
// Get grading scales
app.get('/api/academic/grading-scales', (req, res) => {
    const scales = readFile(academicFiles.gradingScales, {});
    res.json(scales);
});

// Save grading scale
app.post('/api/academic/grading-scales', (req, res) => {
    const { name, scale } = req.body;
    
    if (!name || !scale) {
        return res.status(400).json({ error: 'Name and scale required' });
    }
    
    const scales = readFile(academicFiles.gradingScales, {});
    scales[name] = scale;
    saveFile(academicFiles.gradingScales, scales);
    
    res.json({ success: true });
});

// Set default grading scale
app.post('/api/academic/grading-scales/default', (req, res) => {
    const { name } = req.body;
    const scales = readFile(academicFiles.gradingScales, {});
    
    if (!scales[name]) {
        return res.status(404).json({ error: 'Scale not found' });
    }
    
    // Move the selected scale to 'default'
    const defaultScale = scales[name];
    delete scales[name];
    scales.default = defaultScale;
    saveFile(academicFiles.gradingScales, scales);
    
    res.json({ success: true });
});

// ==================== REPORT CARD TEMPLATES ====================
// Get all templates
app.get('/api/academic/report-templates', (req, res) => {
    const templates = readFile(academicFiles.reportTemplates, {});
    res.json(templates);
});

// Save template
app.post('/api/academic/report-templates', (req, res) => {
    const { id, name, template } = req.body;
    
    if (!name || !template) {
        return res.status(400).json({ error: 'Name and template required' });
    }
    
    const templates = readFile(academicFiles.reportTemplates, {});
    templates[id || uuidv4()] = { name, template, createdAt: new Date().toISOString() };
    saveFile(academicFiles.reportTemplates, templates);
    
    res.json({ success: true });
});

// Update template
app.put('/api/academic/report-templates/:id', (req, res) => {
    const { name, template } = req.body;
    const templates = readFile(academicFiles.reportTemplates, {});
    
    if (!templates[req.params.id]) {
        return res.status(404).json({ error: 'Template not found' });
    }
    
    templates[req.params.id] = { 
        ...templates[req.params.id], 
        name, 
        template, 
        updatedAt: new Date().toISOString() 
    };
    
    saveFile(academicFiles.reportTemplates, templates);
    res.json({ success: true });
});

// Delete template
app.delete('/api/academic/report-templates/:id', (req, res) => {
    const templates = readFile(academicFiles.reportTemplates, {});
    delete templates[req.params.id];
    saveFile(academicFiles.reportTemplates, templates);
    res.json({ success: true });
});

// ==================== REPORT CARDS (Scores Entry) ====================
// Get report cards for a class
app.get('/api/academic/report-cards/:classId/:term/:year', (req, res) => {
    const { classId, term, year } = req.params;
    const reportCards = readFile(academicFiles.reportCards, []);
    
    const cards = reportCards.filter(rc => 
        rc.classId === classId && 
        rc.term === parseInt(term) && 
        rc.year === parseInt(year)
    );
    
    res.json(cards);
});

// Get report card for a student
app.get('/api/academic/report-cards/student/:studentId/:term/:year', (req, res) => {
    const { studentId, term, year } = req.params;
    const reportCards = readFile(academicFiles.reportCards, []);
    
    const card = reportCards.find(rc => 
        rc.studentId === studentId && 
        rc.term === parseInt(term) && 
        rc.year === parseInt(year)
    );
    
    res.json(card || null);
});

// Save report card (scores)
app.post('/api/academic/report-cards', (req, res) => {
    const { studentId, classId, term, year, subjects, teacherComment, recommendation } = req.body;
    
    if (!studentId || !classId || !term || !year) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    let reportCards = readFile(academicFiles.reportCards, []);
    
    const index = reportCards.findIndex(rc => 
        rc.studentId === studentId && 
        rc.classId === classId && 
        rc.term === term && 
        rc.year === year
    );
    
    const reportCard = {
        studentId,
        classId,
        term,
        year,
        subjects: subjects || [],
        teacherComment: teacherComment || '',
        recommendation: recommendation || '',
        updatedAt: new Date().toISOString()
    };
    
    if (index !== -1) {
        reportCards[index] = { ...reportCards[index], ...reportCard };
    } else {
        reportCards.push({
            id: uuidv4(),
            ...reportCard,
            createdAt: new Date().toISOString()
        });
    }
    
    saveFile(academicFiles.reportCards, reportCards);
    res.json({ success: true });
});

// Save multiple report cards (bulk)
app.post('/api/academic/report-cards/bulk', (req, res) => {
    const { cards } = req.body;
    
    if (!cards || !Array.isArray(cards) || cards.length === 0) {
        return res.status(400).json({ error: 'No cards provided' });
    }
    
    let reportCards = readFile(academicFiles.reportCards, []);
    
    cards.forEach(card => {
        const index = reportCards.findIndex(rc => 
            rc.studentId === card.studentId && 
            rc.classId === card.classId && 
            rc.term === card.term && 
            rc.year === card.year
        );
        
        if (index !== -1) {
            reportCards[index] = { ...reportCards[index], ...card, updatedAt: new Date().toISOString() };
        } else {
            reportCards.push({
                id: uuidv4(),
                ...card,
                createdAt: new Date().toISOString()
            });
        }
    });
    
    saveFile(academicFiles.reportCards, reportCards);
    res.json({ success: true, count: cards.length });
});

// ==================== STUDENT PROGRESSION ====================
// Get student progress
app.get('/api/academic/student-progress/:studentId', (req, res) => {
    const progress = readFile(academicFiles.studentProgress, []);
    const studentProgress = progress.filter(p => p.studentId === req.params.studentId);
    res.json(studentProgress);
});

// Promote students
app.post('/api/academic/promote-students', async (req, res) => {
    const { studentIds, fromClassId, toClassId, academicYear, term } = req.body;
    
    if (!studentIds || !studentIds.length || !toClassId) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const progress = readFile(academicFiles.studentProgress, []);
    const students = await syncStudentsFromMainSystem();
    
    // Also update in main system if online
    let promotionResults = [];
    
    for (const studentId of studentIds) {
        const student = students.find(s => s.id === studentId);
        if (!student) continue;
        
        // Record progress
        progress.push({
            id: uuidv4(),
            studentId: studentId,
            fromClassId: fromClassId || student.currentClassId,
            toClassId: toClassId,
            academicYear: academicYear || new Date().getFullYear(),
            term: term || 1,
            status: 'promoted',
            promotedAt: new Date().toISOString()
        });
        
        // Try to update in main system
        try {
            // Update student's class in main system
            const response = await fetch('http://localhost:3000/api/students/' + studentId, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentClassId: toClassId,
                    updatedAt: new Date().toISOString()
                })
            });
            
            if (response.ok) {
                promotionResults.push({ studentId, success: true });
            } else {
                promotionResults.push({ studentId, success: false, error: 'Main system update failed' });
            }
        } catch (error) {
            promotionResults.push({ studentId, success: false, error: error.message });
        }
    }
    
    saveFile(academicFiles.studentProgress, progress);
    res.json({ success: true, results: promotionResults });
});

// Retain students (failed)
app.post('/api/academic/retain-students', (req, res) => {
    const { studentIds, fromClassId, academicYear, term } = req.body;
    
    if (!studentIds || !studentIds.length) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const progress = readFile(academicFiles.studentProgress, []);
    
    for (const studentId of studentIds) {
        progress.push({
            id: uuidv4(),
            studentId: studentId,
            fromClassId: fromClassId,
            toClassId: fromClassId, // Same class
            academicYear: academicYear || new Date().getFullYear(),
            term: term || 1,
            status: 'retained',
            retainedAt: new Date().toISOString()
        });
    }
    
    saveFile(academicFiles.studentProgress, progress);
    res.json({ success: true, count: studentIds.length });
});

// ==================== DASHBOARD STATISTICS ====================
// Get teacher dashboard stats
app.get('/api/academic/dashboard/:teacherId', async (req, res) => {
    const { teacherId } = req.params;
    
    // Get teacher's class
    const assignments = readFile(academicFiles.classAssignments, []);
    const assignment = assignments.find(a => a.teacherId === teacherId && a.isActive);
    
    if (!assignment) {
        return res.status(404).json({ error: 'No class assigned' });
    }
    
    const classId = assignment.classId;
    const terms = readFile(academicFiles.terms, {});
    const currentYear = terms.currentYear || new Date().getFullYear();
    const currentTerm = terms.currentTerm || 1;
    
    // Get students
    const students = await syncStudentsFromMainSystem();
    const classStudents = students.filter(s => s.currentClassId === classId);
    
    // Get report cards
    const reportCards = readFile(academicFiles.reportCards, []);
    const classReportCards = reportCards.filter(rc => 
        rc.classId === classId && 
        rc.term === currentTerm && 
        rc.year === currentYear
    );
    
    // Calculate statistics
    const totalStudents = classStudents.length;
    const hasReportCards = classReportCards.length > 0;
    
    let averageScore = 0;
    let passedCount = 0;
    let failedCount = 0;
    let gradeDistribution = {};
    
    if (hasReportCards) {
        const grades = readFile(academicFiles.gradingScales, {});
        const defaultScale = grades.default || {};
        
        classReportCards.forEach(card => {
            let totalScore = 0;
            let subjectCount = 0;
            
            card.subjects.forEach(subj => {
                totalScore += subj.score || 0;
                subjectCount++;
            });
            
            const avg = subjectCount > 0 ? totalScore / subjectCount : 0;
            
            // Check if passed (typically >= 50)
            if (avg >= 50) passedCount++;
            else failedCount++;
            
            // Grade distribution
            for (const [grade, data] of Object.entries(defaultScale)) {
                if (avg >= data.min && avg <= data.max) {
                    gradeDistribution[grade] = (gradeDistribution[grade] || 0) + 1;
                    break;
                }
            }
        });
        
        averageScore = classReportCards.length > 0 ? 
            classReportCards.reduce((sum, card) => {
                let total = 0;
                let count = 0;
                card.subjects.forEach(subj => {
                    total += subj.score || 0;
                    count++;
                });
                return sum + (count > 0 ? total / count : 0);
            }, 0) / classReportCards.length : 0;
    }
    
    // Get timetable
    const timetables = readFile(academicFiles.timetables, []);
    const timetable = timetables.find(t => 
        t.classId === classId && 
        t.term === currentTerm && 
        t.year === currentYear
    );
    
    // Get sweeping roster
    const rosters = readFile(academicFiles.sweepingRosters, []);
    const roster = rosters.find(r => 
        r.classId === classId && 
        r.term === currentTerm && 
        r.year === currentYear
    );
    
    res.json({
        teacherId,
        classId,
        className: assignment.className,
        currentTerm,
        currentYear,
        totalStudents,
        hasReportCards,
        averageScore: Math.round(averageScore),
        passedCount,
        failedCount,
        gradeDistribution,
        timetable: timetable || null,
        sweepingRoster: roster || null,
        students: classStudents.map(s => ({
            id: s.id,
            admissionNumber: s.admissionNumber,
            firstName: s.firstName,
            lastName: s.lastName,
            gender: s.gender
        })),
        reportCards: classReportCards
    });
});

// ==================== TERM MANAGEMENT ====================
// Get terms
app.get('/api/academic/terms', (req, res) => {
    const terms = readFile(academicFiles.terms, {});
    res.json(terms);
});

// Update terms
app.post('/api/academic/terms', (req, res) => {
    const { currentYear, currentTerm, terms } = req.body;
    
    const termData = readFile(academicFiles.terms, {});
    
    if (currentYear) termData.currentYear = currentYear;
    if (currentTerm) termData.currentTerm = currentTerm;
    if (terms) termData.terms = terms;
    
    saveFile(academicFiles.terms, termData);
    res.json({ success: true });
});

// ==================== SYNC ROUTES ====================
// Sync all data from main system
app.post('/api/academic/sync', async (req, res) => {
    try {
        const [students, classes, subjects] = await Promise.all([
            syncStudentsFromMainSystem(),
            syncClassesFromMainSystem(),
            syncSubjectsFromMainSystem()
        ]);
        
        res.json({
            success: true,
            students: students.length,
            classes: classes.length,
            subjects: subjects.length
        });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get synced students
app.get('/api/academic/students', async (req, res) => {
    const students = await syncStudentsFromMainSystem();
    res.json(students);
});

// Get synced classes
app.get('/api/academic/classes', async (req, res) => {
    const classes = await syncClassesFromMainSystem();
    res.json(classes);
});

// Get synced subjects
app.get('/api/academic/subjects', async (req, res) => {
    const subjects = await syncSubjectsFromMainSystem();
    res.json(subjects);
});

// ==================== FRONTEND ROUTES ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'academic.html'));
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'academic.html'));
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log('='.repeat(60));
    console.log('🎓 ACADEMIC MANAGEMENT SYSTEM v1.0');
    console.log('='.repeat(60));
    console.log(`✅ Server running at: http://localhost:${PORT}`);
    console.log(`📁 Data directory: ${academicDir}`);
    console.log('='.repeat(60));
    console.log('📚 Features:');
    console.log('   - Teacher Authentication');
    console.log('   - Class Management');
    console.log('   - Timetable & Sweeping Roster');
    console.log('   - Report Card Management');
    console.log('   - Grading System');
    console.log('   - Student Progression');
    console.log('   - Integration with Main System');
    console.log('='.repeat(60));
    console.log('🚀 Ready to serve!');
});

// ==================== EXPORT FOR TESTING ====================
module.exports = app;