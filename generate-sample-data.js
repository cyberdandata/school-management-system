// ============================================
// SCHOOL MANAGEMENT SYSTEM - SAMPLE DATA GENERATOR
// Version: 1.0 - Complete Strategic Data Set
// ============================================

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ==================== CONFIGURATION ====================
const DATA_DIR = path.join(__dirname, 'data');
const SCHOOL_NAME = 'Eden Christian School';
const SCHOOL_MOTTO = 'Quality Education for All';
const CURRENT_YEAR = 2026;
const CURRENT_TERM = 1;

// ==================== ENSURE DATA DIRECTORY ====================
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== HELPER FUNCTIONS ====================
function generateId() {
    return uuidv4();
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max, decimals = 2) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
}

function randomDate(start, end) {
    return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function formatMoney(amount) {
    return amount.toLocaleString('en-US');
}

// ==================== SCHOOL DATA ====================
function generateSchool() {
    return {
        id: generateId(),
        schoolName: SCHOOL_NAME,
        name: SCHOOL_NAME,
        motto: SCHOOL_MOTTO,
        address: 'Mukono-Nasuuti, Mukono District, Uganda',
        phone: '+256 700 000 000',
        email: 'info@edenchristian.ug',
        logo: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

// ==================== CLASSES DATA ====================
function generateClasses() {
    return [
        { id: generateId(), name: 'Baby Class', level: 'Nursery', order: 1, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Middle Class', level: 'Nursery', order: 2, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Top Class', level: 'Nursery', order: 3, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'P.1', level: 'LowerPrimary', order: 4, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'P.2', level: 'LowerPrimary', order: 5, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'P.3', level: 'LowerPrimary', order: 6, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'P.4', level: 'UpperPrimary', order: 7, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'P.5', level: 'UpperPrimary', order: 8, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'P.6', level: 'UpperPrimary', order: 9, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'P.7', level: 'UpperPrimary', order: 10, createdAt: new Date().toISOString() }
    ];
}

// ==================== STATUS GROUPS ====================
function generateStatusGroups() {
    return [
        { id: generateId(), name: 'Scholastic', description: 'School materials and supplies', color: '#10b981', createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Transportation', description: 'School transport fees', color: '#f59e0b', createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Admission Fee', description: 'One-time admission fees', color: '#8b5cf6', createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Sports', description: 'Sports and games fees', color: '#ef4444', createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Development', description: 'School development fees', color: '#06b6d4', createdAt: new Date().toISOString() }
    ];
}

// ==================== SUBJECTS ====================
function generateSubjects(classes) {
    const coreSubjects = [
        { name: 'English', code: 'ENG', category: 'Core' },
        { name: 'Mathematics', code: 'MATH', category: 'Core' },
        { name: 'Science', code: 'SCI', category: 'Core' },
        { name: 'Social Studies', code: 'SST', category: 'Core' },
        { name: 'Religious Education', code: 'RE', category: 'Core' },
        { name: 'Reading', code: 'READ', category: 'Core' },
        { name: 'Writing', code: 'WRIT', category: 'Core' },
        { name: 'Local Language', code: 'LOCL', category: 'Core' },
        { name: 'Agriculture', code: 'AGRI', category: 'Core' }
    ];
    
    const electiveSubjects = [
        { name: 'Art & Craft', code: 'ART', category: 'Elective' },
        { name: 'Physical Education', code: 'PE', category: 'Elective' },
        { name: 'Music', code: 'MUSIC', category: 'Elective' },
        { name: 'Dance', code: 'DANCE', category: 'Elective' }
    ];
    
    const allSubjects = [...coreSubjects, ...electiveSubjects];
    
    return allSubjects.map(s => ({
        id: generateId(),
        name: s.name,
        code: s.code,
        category: s.category,
        classId: 'all',
        description: `${s.name} for all classes`,
        createdAt: new Date().toISOString()
    }));
}

// ==================== FEE STRUCTURES ====================
function generateFeeStructures(classes, statusGroups) {
    // Helper to create items for a component
    function createItems(itemsData) {
        return itemsData.map(item => ({
            id: generateId(),
            name: item.name,
            quantity: item.quantity || 1,
            cashAmount: item.cashAmount || 0,
            totalAmount: item.totalAmount || 0,
            paymentOption: item.paymentOption || 'either',
            isTangible: item.paymentOption !== 'cash_only'
        }));
    }
    
    // Helper to create activity components
    function createComponent(name, periodType, items, statusGroupName = null, statusGroupId = null) {
        const totalAmount = items.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
        return {
            id: generateId(),
            name: name,
            periodType: periodType,
            statusGroupId: statusGroupId,
            statusGroupName: statusGroupName,
            items: items,
            totalAmount: totalAmount,
            createdAt: new Date().toISOString()
        };
    }
    
    // Find status group IDs
    const scholasticGroup = statusGroups.find(g => g.name === 'Scholastic');
    const transportGroup = statusGroups.find(g => g.name === 'Transportation');
    const admissionGroup = statusGroups.find(g => g.name === 'Admission Fee');
    const sportsGroup = statusGroups.find(g => g.name === 'Sports');
    const developmentGroup = statusGroups.find(g => g.name === 'Development');
    
    // Fee structures by level
    const nurseryStructures = [
        {
            id: generateId(),
            name: 'Baby Class Day',
            level: 'Nursery',
            tuition: 250000,
            activityComponents: [
                createComponent('Scholastic Materials', 'termly', 
                    createItems([
                        { name: 'Brooms', quantity: 2, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Exercise Books', quantity: 4, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pencils', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Rulers', quantity: 2, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Erasers', quantity: 3, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    scholasticGroup?.name, scholasticGroup?.id
                ),
                createComponent('Sports Equipment', 'termly',
                    createItems([
                        { name: 'Football', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Skipping Ropes', quantity: 2, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    sportsGroup?.name, sportsGroup?.id
                ),
                createComponent('Transportation Fee', 'termly',
                    createItems([
                        { name: 'School Van Transport', quantity: 1, totalAmount: 50000, paymentOption: 'cash_only' }
                    ]),
                    transportGroup?.name, transportGroup?.id
                )
            ],
            isActive: true,
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            name: 'Middle Class Day',
            level: 'Nursery',
            tuition: 280000,
            activityComponents: [
                createComponent('Scholastic Materials', 'termly',
                    createItems([
                        { name: 'Brooms', quantity: 2, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Exercise Books', quantity: 5, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pencils', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Crayons', quantity: 2, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Rulers', quantity: 2, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    scholasticGroup?.name, scholasticGroup?.id
                ),
                createComponent('Sports Equipment', 'termly',
                    createItems([
                        { name: 'Football', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Netball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    sportsGroup?.name, sportsGroup?.id
                ),
                createComponent('Transportation Fee', 'termly',
                    createItems([
                        { name: 'School Van Transport', quantity: 1, totalAmount: 50000, paymentOption: 'cash_only' }
                    ]),
                    transportGroup?.name, transportGroup?.id
                )
            ],
            isActive: true,
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            name: 'Top Class Day',
            level: 'Nursery',
            tuition: 320000,
            activityComponents: [
                createComponent('Scholastic Materials', 'termly',
                    createItems([
                        { name: 'Brooms', quantity: 2, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Exercise Books', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pencils', quantity: 8, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Crayons', quantity: 3, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Rulers', quantity: 2, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Scissors', quantity: 1, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    scholasticGroup?.name, scholasticGroup?.id
                ),
                createComponent('Sports Equipment', 'termly',
                    createItems([
                        { name: 'Football', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Netball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Skipping Ropes', quantity: 3, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    sportsGroup?.name, sportsGroup?.id
                ),
                createComponent('Transportation Fee', 'termly',
                    createItems([
                        { name: 'School Van Transport', quantity: 1, totalAmount: 50000, paymentOption: 'cash_only' }
                    ]),
                    transportGroup?.name, transportGroup?.id
                )
            ],
            isActive: true,
            createdAt: new Date().toISOString()
        }
    ];
    
    const lowerPrimaryStructures = [
        {
            id: generateId(),
            name: 'P.1 - P.3 Standard',
            level: 'LowerPrimary',
            tuition: 350000,
            activityComponents: [
                createComponent('Scholastic Materials', 'termly',
                    createItems([
                        { name: 'Textbooks', quantity: 5, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Exercise Books', quantity: 8, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pens', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pencils', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Rulers', quantity: 2, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Erasers', quantity: 3, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    scholasticGroup?.name, scholasticGroup?.id
                ),
                createComponent('Sports Equipment', 'termly',
                    createItems([
                        { name: 'Football', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Netball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Skipping Ropes', quantity: 4, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    sportsGroup?.name, sportsGroup?.id
                ),
                createComponent('Transportation Fee', 'termly',
                    createItems([
                        { name: 'School Van Transport', quantity: 1, totalAmount: 60000, paymentOption: 'cash_only' }
                    ]),
                    transportGroup?.name, transportGroup?.id
                )
            ],
            isActive: true,
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            name: 'P.1 - P.3 Premium',
            level: 'LowerPrimary',
            tuition: 420000,
            activityComponents: [
                createComponent('Scholastic Materials', 'termly',
                    createItems([
                        { name: 'Textbooks', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Exercise Books', quantity: 10, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pens', quantity: 8, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pencils', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Rulers', quantity: 2, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Erasers', quantity: 3, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    scholasticGroup?.name, scholasticGroup?.id
                ),
                createComponent('Sports Equipment', 'termly',
                    createItems([
                        { name: 'Football', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Netball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Skipping Ropes', quantity: 4, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Basketball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    sportsGroup?.name, sportsGroup?.id
                ),
                createComponent('Transportation Fee', 'termly',
                    createItems([
                        { name: 'School Van Transport', quantity: 1, totalAmount: 60000, paymentOption: 'cash_only' }
                    ]),
                    transportGroup?.name, transportGroup?.id
                )
            ],
            isActive: true,
            createdAt: new Date().toISOString()
        }
    ];
    
    const upperPrimaryStructures = [
        {
            id: generateId(),
            name: 'P.4 - P.7 Standard',
            level: 'UpperPrimary',
            tuition: 400000,
            activityComponents: [
                createComponent('Scholastic Materials', 'termly',
                    createItems([
                        { name: 'Textbooks', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Exercise Books', quantity: 10, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pens', quantity: 8, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pencils', quantity: 6, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Rulers', quantity: 3, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Erasers', quantity: 3, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Set Squares', quantity: 1, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    scholasticGroup?.name, scholasticGroup?.id
                ),
                createComponent('Sports Equipment', 'termly',
                    createItems([
                        { name: 'Football', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Netball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Basketball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Skipping Ropes', quantity: 5, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    sportsGroup?.name, sportsGroup?.id
                ),
                createComponent('Transportation Fee', 'termly',
                    createItems([
                        { name: 'School Van Transport', quantity: 1, totalAmount: 70000, paymentOption: 'cash_only' }
                    ]),
                    transportGroup?.name, transportGroup?.id
                )
            ],
            isActive: true,
            createdAt: new Date().toISOString()
        },
        {
            id: generateId(),
            name: 'P.4 - P.7 Premium',
            level: 'UpperPrimary',
            tuition: 480000,
            activityComponents: [
                createComponent('Scholastic Materials', 'termly',
                    createItems([
                        { name: 'Textbooks', quantity: 8, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Exercise Books', quantity: 12, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pens', quantity: 10, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Pencils', quantity: 8, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Rulers', quantity: 3, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Erasers', quantity: 4, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Set Squares', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Compass', quantity: 1, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    scholasticGroup?.name, scholasticGroup?.id
                ),
                createComponent('Sports Equipment', 'termly',
                    createItems([
                        { name: 'Football', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Netball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Basketball', quantity: 1, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Skipping Ropes', quantity: 5, totalAmount: 0, paymentOption: 'item_only' },
                        { name: 'Tennis Balls', quantity: 6, totalAmount: 0, paymentOption: 'item_only' }
                    ]),
                    sportsGroup?.name, sportsGroup?.id
                ),
                createComponent('Transportation Fee', 'termly',
                    createItems([
                        { name: 'School Van Transport', quantity: 1, totalAmount: 70000, paymentOption: 'cash_only' }
                    ]),
                    transportGroup?.name, transportGroup?.id
                )
            ],
            isActive: true,
            createdAt: new Date().toISOString()
        }
    ];
    
    return [...nurseryStructures, ...lowerPrimaryStructures, ...upperPrimaryStructures];
}

// ==================== STUDENTS ====================
function generateStudents(classes, feeStructures) {
    const firstNames = ['DANIEL', 'SARAH', 'JAMES', 'MARY', 'JOHN', 'PETER', 'PAUL', 'DAVID', 'ELIZABETH', 'GRACE', 'JOSEPH', 'RUTH', 'SAMUEL', 'REBECCA', 'MICHAEL', 'RACHEL', 'DANIEL', 'ESTHER', 'MATTHEW', 'DEBORAH', 'LUKE', 'HANNAH', 'BENJAMIN', 'NAOMI', 'JONATHAN', 'ABIGAIL', 'TIMOTHY', 'SARAH', 'THOMAS', 'ANNE', 'JACOB', 'MARGARET', 'ISAAC', 'CATHERINE', 'NATHAN', 'ANNA', 'DANIEL', 'AMY', 'ANDREW', 'HELEN', 'JOSHUA', 'EMMA', 'ADAM', 'EVA', 'NOAH', 'LUCY', 'GABRIEL', 'JESSICA', 'ARON', 'GLORIA'];
    
    const lastNames = ['WASSWA', 'MUKASA', 'SSEKAJJA', 'KASOZI', 'MUSOKE', 'NAKATO', 'KABUYE', 'KALEMA', 'KAYONGO', 'SSEMBATYA', 'BAGUMA', 'NAMUKASA', 'KIBEKA', 'NANSAMBA', 'SSEBUJJAKA', 'NANTONGO', 'KIIZA', 'NAKIMULI', 'KINYERA', 'NABATANZI', 'SSEMPALA', 'NAZZIWA', 'KASULE', 'NAMAYANJA', 'KASOGO', 'NAKIBUUKA', 'MUBIRU', 'NALULE', 'KAMOGA', 'NASSUNA', 'KIRABO', 'NAKIRYANGA', 'SSEBANDIKE', 'NABADDA', 'KASOZI', 'NANKYA', 'MUKASA', 'NAMATOVU'];
    
    const parentFirstNames = ['JOHN', 'MARY', 'ROBERT', 'ANNE', 'CHARLES', 'SARAH', 'EDWARD', 'JANE', 'GEORGE', 'ALICE', 'JOSEPH', 'MARGARET', 'HENRY', 'ETHEL', 'FRANK', 'HELEN', 'THOMAS', 'RUTH', 'WILLIAM', 'GRACE'];
    const parentLastNames = ['MUKASA', 'KASOZI', 'WASSWA', 'NAKATO', 'SSEKAJJA', 'NANTONGO', 'MUSOKE', 'NAKIMULI', 'KABUYE', 'NAZZIWA', 'KALEMA', 'NAMAYANJA', 'KAYONGO', 'NALULE', 'SSEMBATYA', 'NAKIBUUKA'];
    
    const phones = [
        '0758728037', '0758765432', '0772345678', '0756123456', '0778123456',
        '0781234567', '0756345678', '0779456789', '0759567890', '0780567890'
    ];
    
    const addresses = [
        'Mukono-Nasuuti, Mukono District', 'Bweyogerere, Kampala', 'Najjera, Kampala',
        'Kira, Wakiso', 'Nansana, Wakiso', 'Entebbe, Wakiso', 'Gayaza, Wakiso',
        'Lweza, Kampala', 'Nsangi, Wakiso', 'Buziga, Kampala'
    ];
    
    // Map class names to fee structure levels
    const feeStructureMap = {};
    feeStructures.forEach(fs => {
        if (!feeStructureMap[fs.level]) feeStructureMap[fs.level] = [];
        feeStructureMap[fs.level].push(fs.id);
    });
    
    const students = [];
    const now = new Date();
    const enrollmentStart = new Date('2026-01-10');
    const enrollmentEnd = new Date('2026-02-10');
    
    // Generate 20 students across different classes
    for (let i = 0; i < 20; i++) {
        const firstName = randomChoice(firstNames);
        const lastName = randomChoice(lastNames);
        const gender = randomChoice(['Male', 'Female']);
        const classObj = randomChoice(classes);
        
        // Pick a fee structure for this class level
        const availableFees = feeStructureMap[classObj.level] || [];
        const feeStructureId = availableFees.length > 0 ? randomChoice(availableFees) : null;
        
        const enrollmentDate = randomDate(enrollmentStart, enrollmentEnd);
        const parentFirstName = randomChoice(parentFirstNames);
        const parentLastName = randomChoice(parentLastNames);
        
        students.push({
            id: generateId(),
            admissionNumber: `STU${CURRENT_YEAR}${String(i + 1).padStart(4, '0')}`,
            firstName: firstName,
            lastName: lastName,
            dateOfBirth: formatDate(randomDate(new Date('2010-01-01'), new Date('2020-12-31'))),
            gender: gender,
            birthPlace: randomChoice(['Mukono', 'Kampala', 'Wakiso', 'Entebbe', 'Jinja']),
            nationality: 'Ugandan',
            studentPhoto: null,
            parentInfo: {
                name: `${parentFirstName} ${parentLastName}`,
                relationship: randomChoice(['Parent', 'Guardian']),
                phone: randomChoice(phones),
                altPhone: randomChoice(phones),
                email: `${parentFirstName.toLowerCase()}.${parentLastName.toLowerCase()}@email.com`,
                occupation: randomChoice(['Teacher', 'Business', 'Doctor', 'Engineer', 'Nurse', 'Driver', 'Farmer'])
            },
            address: randomChoice(addresses),
            previousSchool: randomChoice(['Mukono Primary', 'Kampala Junior', 'Entebbe Primary', 'Nansana Primary']),
            admissionType: randomChoice(['New', 'Transfer']),
            enrollmentDate: formatDate(enrollmentDate),
            status: 'Active',
            currentClassId: classObj.id,
            enrolledAt: enrollmentDate.toISOString(),
            createdAt: enrollmentDate.toISOString(),
            updatedAt: enrollmentDate.toISOString(),
            assignedFeeStructureId: feeStructureId,
            customBursary: null,
            customTransportation: null
        });
    }
    
    return students;
}

// ==================== FEE ASSIGNMENTS ====================
function generateFeeAssignments(students, feeStructures, feeBursaries) {
    const assignments = [];
    const activeBursaries = feeBursaries.filter(b => b.isActive);
    
    students.forEach(student => {
        // 30% chance of having a bursary
        const hasBursary = Math.random() < 0.3;
        const bursaryId = hasBursary && activeBursaries.length > 0 ? randomChoice(activeBursaries).id : null;
        
        assignments.push({
            id: generateId(),
            studentId: student.id,
            feeStructureId: student.assignedFeeStructureId || randomChoice(feeStructures).id,
            bursaryId: bursaryId,
            assignedAt: new Date().toISOString()
        });
    });
    
    return assignments;
}

// ==================== FEE BURSARIES ====================
function generateFeeBursaries() {
    return [
        { id: generateId(), name: 'Merit Scholarship', description: 'Top performers in previous term', type: 'percentage', value: 25, category: 'Academic', isActive: true, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Sports Bursary', description: 'Sports talent recognition', type: 'percentage', value: 15, category: 'Sports', isActive: true, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Sibling Discount', description: 'Multiple children enrolled', type: 'percentage', value: 10, category: 'Family', isActive: true, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Staff Child Discount', description: 'Children of staff members', type: 'fixed', value: 50000, category: 'Staff', isActive: true, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Financial Need Bursary', description: 'For financially needy students', type: 'percentage', value: 30, category: 'Financial Need', isActive: true, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Alumni Discount', description: 'Children of alumni', type: 'percentage', value: 15, category: 'Alumni', isActive: true, createdAt: new Date().toISOString() },
        { id: generateId(), name: 'Merit Scholarship - Gold', description: 'Exceptional academic performance', type: 'percentage', value: 40, category: 'Academic', isActive: true, createdAt: new Date().toISOString() }
    ];
}

// ==================== SETTINGS ====================
function generateSettings() {
    return {
        currentAcademicYear: CURRENT_YEAR,
        currentTerm: CURRENT_TERM,
        lastUpdated: new Date().toISOString(),
        gradingSystem: {
            'A': { min: 80, max: 100, remark: 'Excellent' },
            'B': { min: 70, max: 79, remark: 'Very Good' },
            'C': { min: 60, max: 69, remark: 'Good' },
            'D': { min: 50, max: 59, remark: 'Satisfactory' },
            'E': { min: 40, max: 49, remark: 'Fair' },
            'F': { min: 0, max: 39, remark: 'Poor' }
        },
        receiptFooter: 'Thank you for your payment!',
        invoicePrefix: 'INV',
        emailNotifications: true,
        smsNotifications: false,
        autoBackup: false
    };
}

// ==================== ENROLLMENTS ====================
function generateEnrollments(students, classes) {
    const enrollments = [];
    
    students.forEach(student => {
        const classObj = classes.find(c => c.id === student.currentClassId);
        if (classObj) {
            enrollments.push({
                id: generateId(),
                studentId: student.id,
                classId: student.currentClassId,
                academicYear: CURRENT_YEAR,
                isCurrent: true,
                enrolledAt: student.enrolledAt || new Date().toISOString()
            });
        }
    });
    
    return enrollments;
}

// ==================== TERM RECORDS ====================
function generateTermRecords(students, feeStructures) {
    const records = {};
    
    students.forEach(student => {
        const key = `${student.id}_${CURRENT_YEAR}_${CURRENT_TERM}`;
        const feeStructure = feeStructures.find(f => f.id === student.assignedFeeStructureId);
        
        if (!feeStructure) return;
        
        // Find scholastic items for this student
        const scholasticItems = [];
        const termlyComponents = feeStructure.activityComponents?.filter(c => c.periodType === 'termly') || [];
        
        // For each termly component, add items
        termlyComponents.forEach(component => {
            (component.items || []).forEach(item => {
                // Check if this is a scholastic item
                const isScholastic = component.statusGroupName?.toLowerCase().includes('scholastic') || 
                                    component.name?.toLowerCase().includes('scholastic');
                
                if (!isScholastic) return;
                
                // Randomly determine if item was brought (70% chance)
                const isBrought = Math.random() < 0.7;
                const itemsBrought = isBrought ? item.quantity || 1 : 0;
                
                scholasticItems.push({
                    componentId: component.id,
                    componentName: component.name,
                    periodType: 'termly',
                    itemId: item.id,
                    itemName: item.name,
                    unitPrice: item.unitPrice || 0,
                    quantityRequired: item.quantity || 1,
                    paymentType: isBrought ? 'brought_item' : null,
                    amountPaid: null,
                    itemsBrought: itemsBrought,
                    cashEquivalent: null,
                    itemsCovered: itemsBrought,
                    remainingQuantity: Math.max(0, (item.quantity || 1) - itemsBrought),
                    remainingAmount: 0,
                    status: itemsBrought >= (item.quantity || 1) ? 'fully_paid' : 'partial',
                    recordedAt: new Date().toISOString(),
                    payments: itemsBrought > 0 ? [{
                        date: new Date().toISOString(),
                        amount: 0,
                        type: 'brought_item',
                        itemsBrought: itemsBrought
                    }] : []
                });
            });
        });
        
        records[key] = {
            studentId: student.id,
            year: CURRENT_YEAR,
            term: CURRENT_TERM,
            activityItemsPaid: {
                one_time: [],
                termly: scholasticItems,
                yearly: []
            },
            tuitionTotalPaid: 0,
            activityTotalPaid: 0,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
        };
    });
    
    return records;
}

// ==================== FEE PAYMENTS ====================
function generateFeePayments(students, feeStructures) {
    const payments = [];
    const receiptPrefix = 'RCP';
    let receiptCounter = 1781900000000;
    
    // Payment methods
    const methods = ['cash', 'bank', 'mobile'];
    const methodDistribution = { cash: 0.6, bank: 0.25, mobile: 0.15 };
    
    students.forEach((student, index) => {
        const feeStructure = feeStructures.find(f => f.id === student.assignedFeeStructureId);
        if (!feeStructure) return;
        
        // Determine if student has made a payment (80% chance)
        const hasPayment = Math.random() < 0.8;
        if (!hasPayment) return;
        
        // Find scholastic items for this student from fee structure
        const termlyComponents = feeStructure.activityComponents?.filter(c => c.periodType === 'termly') || [];
        const scholasticItems = [];
        
        termlyComponents.forEach(component => {
            const isScholastic = component.statusGroupName?.toLowerCase().includes('scholastic') || 
                                component.name?.toLowerCase().includes('scholastic');
            
            if (isScholastic) {
                (component.items || []).forEach(item => {
                    const itemsBrought = Math.random() < 0.7 ? (item.quantity || 1) : 0;
                    if (itemsBrought > 0) {
                        scholasticItems.push({
                            periodType: 'termly',
                            componentName: component.name,
                            itemName: item.name,
                            unitPrice: item.unitPrice || 0,
                            quantityRequired: item.quantity || 1,
                            paymentType: 'brought_item',
                            amountPaid: null,
                            itemsBrought: itemsBrought,
                            cashEquivalent: null
                        });
                    }
                });
            }
        });
        
        // Determine if tuition was paid (50% chance)
        const tuitionPaid = Math.random() < 0.5 ? Math.round(feeStructure.tuition * (0.3 + Math.random() * 0.7)) : 0;
        
        // Determine payment method
        let method = 'cash';
        const rand = Math.random();
        if (rand < methodDistribution.cash) method = 'cash';
        else if (rand < methodDistribution.cash + methodDistribution.bank) method = 'bank';
        else method = 'mobile';
        
        // Only create payment if there is at least some payment
        if (tuitionPaid === 0 && scholasticItems.length === 0) return;
        
        const paymentDate = randomDate(new Date('2026-01-15'), new Date('2026-06-20'));
        const receiptNumber = `${receiptPrefix}${receiptCounter + index}`;
        
        payments.push({
            id: generateId(),
            studentId: student.id,
            studentName: `${student.firstName} ${student.lastName}`,
            admissionNumber: student.admissionNumber,
            term: CURRENT_TERM,
            academicYear: CURRENT_YEAR.toString(),
            feeStructureId: student.assignedFeeStructureId,
            feeStructureName: feeStructure.name,
            bursaryId: null,
            bursaryName: null,
            tuitionPaid: tuitionPaid,
            activityTotalPaid: 0,
            activityItemPayments: scholasticItems,
            paymentsByPeriodType: {
                one_time: [],
                termly: scholasticItems,
                yearly: []
            },
            totalAmount: tuitionPaid,
            method: method,
            date: paymentDate.toISOString(),
            reference: `REF-${receiptCounter + index}`,
            notes: `Payment for ${CURRENT_TERM} term ${CURRENT_YEAR}`,
            receiptNumber: receiptNumber,
            recordedAt: paymentDate.toISOString()
        });
    });
    
    return payments;
}

// ==================== INVENTORY DATA ====================
function generateInventoryData(students, feeStructures) {
    const stock = {};
    const transactions = [];
    const itemNames = new Set();
    
    // Collect all scholastic item names from fee structures
    feeStructures.forEach(fs => {
        (fs.activityComponents || []).forEach(comp => {
            const isScholastic = comp.statusGroupName?.toLowerCase().includes('scholastic') || 
                                comp.name?.toLowerCase().includes('scholastic');
            if (isScholastic) {
                (comp.items || []).forEach(item => {
                    itemNames.add(item.name);
                });
            }
        });
    });
    
    // Initialize stock for each item
    const itemsList = Array.from(itemNames);
    itemsList.forEach(itemName => {
        stock[itemName] = {
            name: itemName,
            totalReceived: 0,
            issued: 0,
            available: 0,
            lastUpdated: new Date().toISOString()
        };
    });
    
    // Process transactions from payments
    students.forEach(student => {
        // Find payments for this student
        const studentPayments = []; // This would be filled from feePayments
        
        // For sample data, we'll create some transactions based on students
        const hasIssued = Math.random() < 0.6;
        if (!hasIssued) return;
        
        const itemName = randomChoice(itemsList);
        if (!itemName) return;
        
        const quantity = randomInt(1, 3);
        const destinations = ['classroom', 'office', 'library', 'staff_room', 'science_lab'];
        const destination = randomChoice(destinations);
        
        // Update stock
        if (!stock[itemName]) return;
        stock[itemName].issued = (stock[itemName].issued || 0) + quantity;
        stock[itemName].available = Math.max(0, (stock[itemName].available || 0) - quantity);
        stock[itemName].lastUpdated = new Date().toISOString();
        
        // Create transaction
        transactions.push({
            id: generateId(),
            studentId: student.id,
            studentName: `${student.firstName} ${student.lastName}`,
            admissionNumber: student.admissionNumber,
            itemName: itemName,
            quantity: quantity,
            transactionType: 'issue',
            destination: destination,
            recipient: `${student.firstName} ${student.lastName}`,
            comment: `Issued ${quantity} ${itemName}(s) to ${student.firstName}`,
            stockBefore: stock[itemName].available + quantity,
            stockAfter: stock[itemName].available,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0],
            isUniform: false,
            canEdit: true,
            canReverse: true
        });
    });
    
    return { stock, transactions };
}

// ==================== TEACHERS ====================
function generateTeachers(classes, subjects) {
    const firstNames = ['JAMES', 'SARAH', 'MICHAEL', 'ELIZABETH', 'JOHN', 'MARY', 'DAVID', 'MARGARET', 'ROBERT', 'HELEN', 'PETER', 'CATHERINE', 'PAUL', 'ANNE', 'ANDREW', 'SUSAN', 'MARK', 'JANET', 'LUKE', 'GRACE'];
    const lastNames = ['MUKASA', 'NAKATO', 'SSEKAJJA', 'KASOZI', 'MUSOKE', 'NANTONGO', 'KABUYE', 'NAKIMULI', 'KALEMA', 'NAZZIWA', 'KAYONGO', 'NALULE', 'SSEMBATYA', 'NAKIBUUKA', 'KIIZA', 'NABATANZI', 'KINYERA', 'NAMAYANJA', 'SSEMPALA', 'NABBANJA'];
    const qualifications = ["Bachelor's Degree", "Master's Degree", "Diploma", "Certificate", "PhD"];
    const specializations = ['Mathematics', 'English', 'Science', 'Social Studies', 'Religious Education', 'Agriculture', 'Music', 'Art', 'Physical Education', 'Languages'];
    
    // Select a subset of classes for each teacher
    const teachers = [];
    const numTeachers = 8;
    
    for (let i = 0; i < numTeachers; i++) {
        const firstName = randomChoice(firstNames);
        const lastName = randomChoice(lastNames);
        const gender = randomChoice(['Male', 'Female']);
        const qualification = randomChoice(qualifications);
        const specialization = randomChoice(specializations);
        
        // Assign 2-4 subjects
        const numSubjects = randomInt(2, 4);
        const shuffledSubjects = [...subjects].sort(() => Math.random() - 0.5);
        const teacherSubjects = shuffledSubjects.slice(0, numSubjects).map(s => s.id);
        
        // Assign 2-3 classes
        const numClasses = randomInt(2, 3);
        const shuffledClasses = [...classes].sort(() => Math.random() - 0.5);
        const teacherClasses = shuffledClasses.slice(0, numClasses).map(c => c.id);
        
        teachers.push({
            id: generateId(),
            teacherId: `TCH${CURRENT_YEAR}${String(i + 1).padStart(4, '0')}`,
            firstName: firstName,
            lastName: lastName,
            gender: gender,
            phone: randomChoice(['0758123456', '0778234567', '0789345678', '0756456789', '0777567890']),
            email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@school.ug`,
            dateOfBirth: formatDate(randomDate(new Date('1980-01-01'), new Date('2000-12-31'))),
            qualification: qualification,
            specialization: specialization,
            subjects: teacherSubjects,
            classes: teacherClasses,
            address: randomChoice(['Mukono', 'Kampala', 'Wakiso', 'Entebbe', 'Jinja']),
            joinedAt: formatDate(randomDate(new Date('2020-01-01'), new Date('2025-12-31'))),
            status: randomChoice(['Active', 'Active', 'Active', 'On Leave']),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }
    
    return teachers;
}

// ==================== ASSESSMENTS ====================
function generateAssessments(classes, subjects) {
    const assessments = [];
    const assessmentTypes = ['CAT1', 'CAT2', 'Exam', 'Assignment', 'Project'];
    const term = CURRENT_TERM;
    const year = CURRENT_YEAR;
    
    // For each class, create assessments for each subject
    classes.forEach(classObj => {
        // Get subjects for this class (or all subjects)
        const classSubjects = subjects.filter(s => s.classId === 'all' || s.classId === classObj.id);
        
        classSubjects.forEach(subject => {
            // Create 2-3 assessments per subject
            const numAssessments = randomInt(2, 3);
            for (let i = 0; i < numAssessments; i++) {
                const type = randomChoice(assessmentTypes);
                assessments.push({
                    id: generateId(),
                    name: `${subject.name} ${type} ${i + 1}`,
                    type: type,
                    subjectId: subject.id,
                    classId: classObj.id,
                    term: term,
                    year: year,
                    maxScore: 100,
                    weight: type === 'Exam' ? 60 : 20,
                    date: formatDate(randomDate(new Date('2026-02-01'), new Date('2026-06-15'))),
                    createdAt: new Date().toISOString()
                });
            }
        });
    });
    
    return assessments;
}

// ==================== ATTENDANCE ====================
function generateAttendance(students, classes) {
    const attendance = [];
    const startDate = new Date('2026-01-15');
    const endDate = new Date('2026-06-15');
    const currentDate = new Date(startDate);
    
    // For each day in the term (approximately 60 days)
    let dayCount = 0;
    while (currentDate <= endDate && dayCount < 60) {
        // Skip weekends
        if (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
            currentDate.setDate(currentDate.getDate() + 1);
            continue;
        }
        
        // For each class, create an attendance record
        classes.forEach(classObj => {
            const classStudents = students.filter(s => s.currentClassId === classObj.id);
            if (classStudents.length === 0) return;
            
            const records = {};
            classStudents.forEach(student => {
                // 85% attendance rate
                const isPresent = Math.random() < 0.85;
                records[student.id] = {
                    status: isPresent ? 'present' : 'absent',
                    timeIn: isPresent ? '08:00' : null,
                    timeOut: isPresent ? '16:00' : null,
                    remarks: isPresent ? null : randomChoice(['Sick', 'Late', 'Excused', 'Unexcused'])
                };
            });
            
            attendance.push({
                id: generateId(),
                date: formatDate(currentDate),
                classId: classObj.id,
                records: records,
                createdAt: new Date().toISOString()
            });
        });
        
        currentDate.setDate(currentDate.getDate() + 1);
        dayCount++;
    }
    
    return attendance;
}

// ==================== UNIFORM DATA ====================
function generateUniformData(students) {
    const stock = {};
    const transactions = [];
    const assignments = {};
    
    // Uniform items
    const uniformItems = ['School Shirt', 'School Skirt', 'School Trousers', 'School Dress', 'Socks', 'Shoes', 'School Tie', 'School Blazer'];
    
    // Initialize stock
    uniformItems.forEach(item => {
        const received = randomInt(50, 100);
        stock[item] = {
            name: item,
            totalReceived: received,
            issued: 0,
            available: received,
            lastUpdated: new Date().toISOString()
        };
    });
    
    // Create uniform assignments for some students
    students.forEach(student => {
        if (Math.random() < 0.7) {
            assignments[student.id] = {
                studentId: student.id,
                studentName: `${student.firstName} ${student.lastName}`,
                admissionNumber: student.admissionNumber,
                items: {}
            };
            
            // Assign 2-4 uniform items
            const numItems = randomInt(2, 4);
            const shuffledItems = [...uniformItems].sort(() => Math.random() - 0.5);
            const selectedItems = shuffledItems.slice(0, numItems);
            
            selectedItems.forEach(itemName => {
                const quantity = randomInt(1, 2);
                assignments[student.id].items[itemName] = {
                    name: itemName,
                    totalIssued: quantity,
                    remaining: 0,
                    transactions: [{
                        date: new Date().toISOString().split('T')[0],
                        quantity: quantity,
                        comment: `Uniform issued to ${student.firstName}`,
                        transactionId: generateId()
                    }]
                };
                
                // Update stock
                if (stock[itemName]) {
                    const issued = stock[itemName].issued || 0;
                    stock[itemName].issued = issued + quantity;
                    stock[itemName].available = Math.max(0, stock[itemName].available - quantity);
                    stock[itemName].lastUpdated = new Date().toISOString();
                }
                
                // Create transaction
                transactions.push({
                    id: generateId(),
                    studentId: student.id,
                    studentName: `${student.firstName} ${student.lastName}`,
                    admissionNumber: student.admissionNumber,
                    itemName: itemName,
                    quantity: quantity,
                    transactionType: 'issue',
                    comment: `Uniform issued to ${student.firstName}`,
                    stockBefore: stock[itemName]?.available + quantity || 0,
                    stockAfter: stock[itemName]?.available || 0,
                    timestamp: new Date().toISOString(),
                    date: new Date().toISOString().split('T')[0],
                    isUniform: true
                });
            });
        }
    });
    
    return { stock, transactions, assignments };
}

// ==================== WRITE DATA TO FILES ====================
function writeDataFile(filename, data) {
    const filePath = path.join(DATA_DIR, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`✅ Generated: ${filename}`);
}

// ==================== MAIN EXECUTION ====================
console.log('\n========================================');
console.log('🏫 SCHOOL MANAGEMENT SYSTEM');
console.log('📊 STRATEGIC SAMPLE DATA GENERATOR');
console.log('========================================\n');

// Generate all data
console.log('📝 Generating data...\n');

// Step 1: Core data
const school = generateSchool();
const settings = generateSettings();
const classes = generateClasses();
const statusGroups = generateStatusGroups();
const subjects = generateSubjects(classes);
const feeBursaries = generateFeeBursaries();

// Step 2: Fee structures (needs status groups)
const feeStructures = generateFeeStructures(classes, statusGroups);

// Step 3: Students (needs classes and fee structures)
const students = generateStudents(classes, feeStructures);

// Step 4: Enrollments
const enrollments = generateEnrollments(students, classes);

// Step 5: Fee assignments
const feeAssignments = generateFeeAssignments(students, feeStructures, feeBursaries);

// Step 6: Fee payments
const feePayments = generateFeePayments(students, feeStructures);

// Step 7: Term records
const termRecords = generateTermRecords(students, feeStructures);

// Step 8: Teachers
const teachers = generateTeachers(classes, subjects);

// Step 9: Assessments
const assessments = generateAssessments(classes, subjects);

// Step 10: Attendance
const attendance = generateAttendance(students, classes);

// Step 11: Inventory
const inventoryData = generateInventoryData(students, feeStructures);

// Step 12: Uniform
const uniformData = generateUniformData(students);

// Write all files
console.log('💾 Writing data files...\n');

writeDataFile('schools.json', [school]);
writeDataFile('settings.json', settings);
writeDataFile('classes.json', classes);
writeDataFile('statusGroups.json', statusGroups);
writeDataFile('subjects.json', subjects);
writeDataFile('feeBursaries.json', feeBursaries);
writeDataFile('feeStructures.json', feeStructures);
writeDataFile('students.json', students);
writeDataFile('enrollments.json', enrollments);
writeDataFile('studentFeeAssignments.json', feeAssignments);
writeDataFile('feePayments.json', feePayments);
writeDataFile('studentTermRecords.json', termRecords);
writeDataFile('teachers.json', teachers);
writeDataFile('assessments.json', assessments);
writeDataFile('attendance.json', attendance);
writeDataFile('inventoryStock.json', inventoryData.stock);
writeDataFile('inventoryTransactions.json', inventoryData.transactions);
writeDataFile('uniformStock.json', uniformData.stock);
writeDataFile('uniformTransactions.json', uniformData.transactions);
writeDataFile('uniformAssignments.json', uniformData.assignments);

// Empty or default files
writeDataFile('scores.json', []);
writeDataFile('feeStructures.json', feeStructures);
writeDataFile('inventoryItems.json', {});
writeDataFile('teachers.json', teachers);

// ==================== SUMMARY ====================
console.log('\n========================================');
console.log('✅ DATA GENERATION COMPLETE!');
console.log('========================================');
console.log('\n📊 SUMMARY:');
console.log(`   🏫 School: ${school.schoolName}`);
console.log(`   📚 Classes: ${classes.length}`);
console.log(`   👨‍🎓 Students: ${students.length}`);
console.log(`   👨‍🏫 Teachers: ${teachers.length}`);
console.log(`   💰 Fee Structures: ${feeStructures.length}`);
console.log(`   🎖️ Bursaries: ${feeBursaries.length}`);
console.log(`   💳 Payments: ${feePayments.length}`);
console.log(`   📋 Assessments: ${assessments.length}`);
console.log(`   📅 Attendance Records: ${attendance.length}`);
console.log(`   📦 Inventory Items: ${Object.keys(inventoryData.stock).length}`);
console.log(`   👕 Uniform Items: ${Object.keys(uniformData.stock).length}`);
console.log('\n📁 Data saved to: ' + DATA_DIR);
console.log('\n🚀 Ready to start the system!\n');