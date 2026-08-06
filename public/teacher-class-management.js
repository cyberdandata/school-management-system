// ==================== TEACHER CLASS MANAGEMENT ====================
// Version: 2.0 - With Class Selection and Attendance Recording

let currentTeacher = null;
let currentTeacherClasses = [];
let selectedClassId = null;
let currentAttendanceDate = new Date().toISOString().split('T')[0];
let attendanceStudents = [];

// ==================== INITIALIZE TEACHER DASHBOARD ====================
async function initTeacherDashboard() {
    try {
        const sessionData = localStorage.getItem('teacherSession');
        if (!sessionData) {
            window.location.href = '/teacher-login.html';
            return;
        }

        const session = JSON.parse(sessionData);
        const response = await fetch('/api/teachers/verify-session', {
            headers: { 'Authorization': `Bearer ${session.token}` }
        });

        if (!response.ok) {
            localStorage.removeItem('teacherSession');
            window.location.href = '/teacher-login.html';
            return;
        }

        const data = await response.json();
        if (data.success && data.sessionValid) {
            currentTeacher = data.teacher;
            currentTeacherClasses = data.teacher.classes || [];
            
            // Show teacher info
            document.getElementById('teacherName').textContent = `${currentTeacher.firstName} ${currentTeacher.lastName}`;
            document.getElementById('teacherId').textContent = currentTeacher.teacherId || 'N/A';
            document.getElementById('welcomeMessage').textContent = `Welcome, ${currentTeacher.firstName} ${currentTeacher.lastName}!`;
            
            // Load class management
            await loadClassManagement();
        } else {
            window.location.href = '/teacher-login.html';
        }
    } catch (error) {
        console.error('Error initializing dashboard:', error);
        window.location.href = '/teacher-login.html';
    }
}

// ==================== LOAD CLASS MANAGEMENT ====================
async function loadClassManagement() {
    const container = document.getElementById('classManagementContainer');
    if (!container) return;

    if (!currentTeacherClasses || currentTeacherClasses.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-500">
                <i class="fas fa-exclamation-circle text-4xl mb-3 text-gray-300"></i>
                <p class="font-medium">No classes assigned to you</p>
                <p class="text-sm">Please contact the administrator to assign you to classes</p>
            </div>
        `;
        return;
    }

    const classes = await fetchClasses(currentTeacherClasses);
    
    // If only one class, auto-select it
    if (classes.length === 1) {
        selectedClassId = classes[0].id;
        await loadClassStudents(selectedClassId);
    }

    container.innerHTML = `
        <div class="space-y-4">
            <!-- Class Selector -->
            <div class="bg-white rounded-xl shadow-sm p-4">
                <div class="flex flex-wrap items-center gap-4">
                    <label class="font-medium text-gray-700">
                        <i class="fas fa-chalkboard"></i> Select Class:
                    </label>
                    <select id="classSelector" class="border rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500">
                        <option value="">-- Select a class --</option>
                        ${classes.map(c => `
                            <option value="${c.id}" ${selectedClassId === c.id ? 'selected' : ''}>
                                ${c.name} (${c.level || 'N/A'}) - ${c.studentCount || 0} students
                            </option>
                        `).join('')}
                    </select>
                    <span id="classInfo" class="text-sm text-gray-500"></span>
                </div>
            </div>

            <!-- Class Management Tabs -->
            <div class="bg-white rounded-xl shadow-sm overflow-hidden">
                <div class="border-b overflow-x-auto">
                    <div class="flex" id="classTabs">
                        <button class="class-tab px-6 py-3 font-medium text-sm active border-b-2 border-blue-600 text-blue-600" data-tab="attendance">
                            <i class="fas fa-clipboard-list"></i> Attendance
                        </button>
                        <button class="class-tab px-6 py-3 font-medium text-sm" data-tab="sweeping">
                            <i class="fas fa-broom"></i> Sweeping Roster
                        </button>
                        <button class="class-tab px-6 py-3 font-medium text-sm" data-tab="homework">
                            <i class="fas fa-book"></i> Homework
                        </button>
                    </div>
                </div>
                <div id="classTabContent" class="p-4">
                    <div class="text-center py-8 text-gray-500">Select a class to begin</div>
                </div>
            </div>
        </div>
    `;

    // Event listeners
    document.getElementById('classSelector').addEventListener('change', function() {
        selectedClassId = this.value;
        if (selectedClassId) {
            loadClassStudents(selectedClassId);
            loadAttendanceTab(selectedClassId);
        }
    });

    document.querySelectorAll('.class-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.class-tab').forEach(t => {
                t.classList.remove('active', 'border-b-2', 'border-blue-600', 'text-blue-600');
                t.classList.add('text-gray-500');
            });
            this.classList.add('active', 'border-b-2', 'border-blue-600', 'text-blue-600');
            this.classList.remove('text-gray-500');
            
            const tabName = this.dataset.tab;
            if (selectedClassId) {
                switch(tabName) {
                    case 'attendance':
                        loadAttendanceTab(selectedClassId);
                        break;
                    case 'sweeping':
                        loadSweepingRosterTab(selectedClassId);
                        break;
                    case 'homework':
                        loadHomeworkTab(selectedClassId);
                        break;
                }
            } else {
                document.getElementById('classTabContent').innerHTML = `
                    <div class="text-center py-8 text-gray-500">
                        <i class="fas fa-info-circle text-3xl mb-2"></i>
                        <p>Please select a class first</p>
                    </div>
                `;
            }
        });
    });

    // Auto-load first tab if class is selected
    if (selectedClassId) {
        await loadClassStudents(selectedClassId);
        loadAttendanceTab(selectedClassId);
    }
}

// ==================== FETCH CLASSES ====================
async function fetchClasses(classIds) {
    try {
        const response = await fetch('/api/school/classes');
        const allClasses = await response.json();
        
        // Get student counts for each class
        const students = await fetch('/api/students').then(r => r.json());
        const enrollments = await fetch('/api/enrollments').then(r => r.json());
        
        const currentEnrollments = enrollments.filter(e => e.isCurrent === true);
        
        return allClasses
            .filter(c => classIds.includes(c.id))
            .map(c => {
                const studentCount = currentEnrollments.filter(e => e.classId === c.id).length;
                return { ...c, studentCount };
            });
    } catch (error) {
        console.error('Error fetching classes:', error);
        return [];
    }
}

// ==================== LOAD CLASS STUDENTS ====================
async function loadClassStudents(classId) {
    try {
        const response = await fetch(`/api/classes/${classId}/students`);
        const data = await response.json();
        
        if (data.success) {
            attendanceStudents = data.students;
            document.getElementById('classInfo').textContent = 
                `📚 ${data.class.name} - ${data.count} students`;
            
            // Update class selector to show count
            const selector = document.getElementById('classSelector');
            const option = selector.querySelector(`option[value="${classId}"]`);
            if (option) {
                option.textContent = `${data.class.name} (${data.class.level || 'N/A'}) - ${data.count} students`;
            }
        }
    } catch (error) {
        console.error('Error loading class students:', error);
    }
}

// ==================== LOAD ATTENDANCE TAB ====================
async function loadAttendanceTab(classId) {
    const container = document.getElementById('classTabContent');
    if (!container) return;

    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    
    // Check if attendance already exists for today
    let existingAttendance = null;
    try {
        const response = await fetch(`/api/attendance/class/${classId}?date=${today}`);
        const data = await response.json();
        if (data.success && data.attendance.length > 0) {
            existingAttendance = data.attendance[0];
        }
    } catch (e) {}

    container.innerHTML = `
        <div class="space-y-4">
            <!-- Date Selector -->
            <div class="flex flex-wrap items-center gap-4 bg-gray-50 p-4 rounded-lg">
                <label class="font-medium text-gray-700">
                    <i class="fas fa-calendar-day"></i> Date:
                </label>
                <input type="date" id="attendanceDate" value="${today}" 
                       class="border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500">
                <button onclick="loadAttendanceForDate()" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                    <i class="fas fa-search"></i> Load
                </button>
                <span id="attendanceStatus" class="text-sm text-gray-500"></span>
            </div>

            <!-- Attendance Summary -->
            <div id="attendanceSummary" class="grid grid-cols-3 gap-4">
                <div class="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                    <p class="text-sm text-gray-500">Present</p>
                    <p class="text-2xl font-bold text-green-600" id="presentCount">0</p>
                </div>
                <div class="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <p class="text-sm text-gray-500">Absent</p>
                    <p class="text-2xl font-bold text-red-600" id="absentCount">0</p>
                </div>
                <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 text-center">
                    <p class="text-sm text-gray-500">Total</p>
                    <p class="text-2xl font-bold text-gray-600" id="totalCount">0</p>
                </div>
            </div>

            <!-- Student List -->
            <div class="border rounded-lg overflow-hidden">
                <div class="bg-gray-100 px-4 py-2 font-semibold flex justify-between items-center">
                    <span><i class="fas fa-users"></i> Students</span>
                    <div class="flex gap-2">
                        <button onclick="selectAllStudents()" class="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700">
                            <i class="fas fa-check-double"></i> All Present
                        </button>
                        <button onclick="deselectAllStudents()" class="text-xs bg-gray-600 text-white px-3 py-1 rounded hover:bg-gray-700">
                            <i class="fas fa-times"></i> All Absent
                        </button>
                    </div>
                </div>
                <div id="studentAttendanceList" class="max-h-96 overflow-y-auto">
                    ${attendanceStudents.length === 0 ? `
                        <div class="text-center py-8 text-gray-500">
                            <i class="fas fa-users text-3xl mb-2 text-gray-300"></i>
                            <p>No students in this class</p>
                        </div>
                    ` : `
                        <table class="w-full text-sm">
                            <thead class="bg-gray-50 sticky top-0">
                                <tr>
                                    <th class="p-2 text-left">#</th>
                                    <th class="p-2 text-left">Admission</th>
                                    <th class="p-2 text-left">Student Name</th>
                                    <th class="p-2 text-center">Gender</th>
                                    <th class="p-2 text-center">Present</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${attendanceStudents.map((student, index) => {
                                    const isPresent = existingAttendance?.records?.find(r => r.studentId === student.id)?.present ?? true;
                                    return `
                                        <tr class="border-b hover:bg-gray-50">
                                            <td class="p-2 text-center text-gray-400 text-xs">${index + 1}</td>
                                            <td class="p-2 font-mono text-xs">${student.admissionNumber || 'N/A'}</td>
                                            <td class="p-2 font-medium">${student.firstName || ''} ${student.lastName || ''}</td>
                                            <td class="p-2 text-center">${student.gender || 'N/A'}</td>
                                            <td class="p-2 text-center">
                                                <label class="relative inline-flex items-center cursor-pointer">
                                                    <input type="checkbox" class="student-attendance-checkbox sr-only" 
                                                           data-student-id="${student.id}" 
                                                           ${isPresent ? 'checked' : ''}>
                                                    <div class="w-10 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-600"></div>
                                                    <span class="ml-2 text-xs status-label ${isPresent ? 'text-green-600' : 'text-red-600'}">${isPresent ? '✅ Present' : '❌ Absent'}</span>
                                                </label>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    `}
                </div>
            </div>

            <!-- Submit Button -->
            <button onclick="submitAttendance()" class="w-full bg-green-600 text-white py-3 rounded-lg font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2">
                <i class="fas fa-save"></i> Save Attendance
            </button>

            <!-- Calendar / History View -->
            <div class="mt-6 border-t pt-4">
                <h4 class="font-bold mb-3"><i class="fas fa-calendar-alt"></i> Attendance History</h4>
                <div id="attendanceHistory" class="max-h-48 overflow-y-auto">
                    <div class="text-center text-gray-400 text-sm py-4">
                        <i class="fas fa-clock"></i> Select a date to view history
                    </div>
                </div>
            </div>
        </div>
    `;

    // Add event listeners for checkboxes to update status labels
    document.querySelectorAll('.student-attendance-checkbox').forEach(cb => {
        cb.addEventListener('change', function() {
            const label = this.closest('label').querySelector('.status-label');
            if (this.checked) {
                label.textContent = '✅ Present';
                label.className = 'ml-2 text-xs status-label text-green-600';
            } else {
                label.textContent = '❌ Absent';
                label.className = 'ml-2 text-xs status-label text-red-600';
            }
            updateAttendanceCounts();
        });
    });

    // Update counts
    updateAttendanceCounts();
    
    // Load history for today
    loadAttendanceHistory(classId, today);
}

// ==================== UPDATE ATTENDANCE COUNTS ====================
function updateAttendanceCounts() {
    const checkboxes = document.querySelectorAll('.student-attendance-checkbox');
    const total = checkboxes.length;
    const present = Array.from(checkboxes).filter(cb => cb.checked).length;
    const absent = total - present;

    document.getElementById('presentCount').textContent = present;
    document.getElementById('absentCount').textContent = absent;
    document.getElementById('totalCount').textContent = total;
}

// ==================== SELECT ALL STUDENTS ====================
function selectAllStudents() {
    document.querySelectorAll('.student-attendance-checkbox').forEach(cb => {
        cb.checked = true;
        const label = cb.closest('label').querySelector('.status-label');
        label.textContent = '✅ Present';
        label.className = 'ml-2 text-xs status-label text-green-600';
    });
    updateAttendanceCounts();
}

// ==================== DESELECT ALL STUDENTS ====================
function deselectAllStudents() {
    document.querySelectorAll('.student-attendance-checkbox').forEach(cb => {
        cb.checked = false;
        const label = cb.closest('label').querySelector('.status-label');
        label.textContent = '❌ Absent';
        label.className = 'ml-2 text-xs status-label text-red-600';
    });
    updateAttendanceCounts();
}

// ==================== LOAD ATTENDANCE FOR DATE ====================
async function loadAttendanceForDate() {
    const date = document.getElementById('attendanceDate').value;
    if (!date) return;
    
    if (!selectedClassId) {
        alert('Please select a class first');
        return;
    }

    try {
        const response = await fetch(`/api/attendance/class/${selectedClassId}?date=${date}`);
        const data = await response.json();
        
        if (data.success && data.attendance.length > 0) {
            const attendance = data.attendance[0];
            // Update checkboxes based on existing attendance
            document.querySelectorAll('.student-attendance-checkbox').forEach(cb => {
                const studentId = cb.dataset.studentId;
                const record = attendance.records.find(r => r.studentId === studentId);
                if (record) {
                    cb.checked = record.present;
                    const label = cb.closest('label').querySelector('.status-label');
                    if (record.present) {
                        label.textContent = '✅ Present';
                        label.className = 'ml-2 text-xs status-label text-green-600';
                    } else {
                        label.textContent = '❌ Absent';
                        label.className = 'ml-2 text-xs status-label text-red-600';
                    }
                }
            });
            updateAttendanceCounts();
            document.getElementById('attendanceStatus').textContent = 
                `📋 Attendance loaded for ${new Date(date).toLocaleDateString()}`;
        } else {
            // Reset all to present (default)
            selectAllStudents();
            document.getElementById('attendanceStatus').textContent = 
                `📋 No attendance found for ${new Date(date).toLocaleDateString()}. All marked present by default.`;
        }
        
        // Load history
        loadAttendanceHistory(selectedClassId, date);
        
    } catch (error) {
        console.error('Error loading attendance for date:', error);
        alert('Error loading attendance for this date');
    }
}

// ==================== LOAD ATTENDANCE HISTORY ====================
async function loadAttendanceHistory(classId, date) {
    const container = document.getElementById('attendanceHistory');
    if (!container) return;

    try {
        const response = await fetch(`/api/attendance/class/${classId}`);
        const data = await response.json();
        
        if (data.success && data.attendance.length > 0) {
            const historyHtml = data.attendance.map(record => {
                const isSelected = record.date === date;
                const dateObj = new Date(record.date);
                const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                
                return `
                    <div class="flex justify-between items-center p-2 border-b hover:bg-gray-50 cursor-pointer ${isSelected ? 'bg-blue-50' : ''}"
                         onclick="loadAttendanceForDateFromHistory('${record.date}')">
                        <div class="flex items-center gap-3">
                            <span class="text-sm font-medium">${dayName}</span>
                            <span class="text-sm">${formattedDate}</span>
                            ${isSelected ? '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Selected</span>' : ''}
                        </div>
                        <div class="flex items-center gap-3 text-sm">
                            <span class="text-green-600">✅ ${record.presentCount || 0}</span>
                            <span class="text-red-600">❌ ${record.absentCount || 0}</span>
                            <span class="text-gray-400">${record.records?.length || 0} total</span>
                        </div>
                    </div>
                `;
            }).join('');
            
            container.innerHTML = historyHtml;
        } else {
            container.innerHTML = `
                <div class="text-center text-gray-400 text-sm py-4">
                    <i class="fas fa-inbox"></i> No attendance records found for this class
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading attendance history:', error);
        container.innerHTML = `
            <div class="text-center text-red-400 text-sm py-4">
                <i class="fas fa-exclamation-circle"></i> Error loading history
            </div>
        `;
    }
}

// ==================== LOAD ATTENDANCE FROM HISTORY ====================
async function loadAttendanceForDateFromHistory(date) {
    document.getElementById('attendanceDate').value = date;
    await loadAttendanceForDate();
}

// ==================== SUBMIT ATTENDANCE ====================
async function submitAttendance() {
    if (!selectedClassId) {
        alert('Please select a class first');
        return;
    }

    const date = document.getElementById('attendanceDate').value;
    if (!date) {
        alert('Please select a date');
        return;
    }

    const checkboxes = document.querySelectorAll('.student-attendance-checkbox');
    const presentStudentIds = Array.from(checkboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.studentId);

    if (presentStudentIds.length === 0) {
        if (!confirm('⚠️ No students marked as present. Are you sure you want to mark all as absent?')) {
            return;
        }
    }

    const submitBtn = document.querySelector('#classTabContent button:last-child');
    const originalText = submitBtn?.innerHTML || 'Save Attendance';
    if (submitBtn) {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        submitBtn.disabled = true;
    }

    try {
        const response = await fetch('/api/attendance/class', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                classId: selectedClassId,
                date: date,
                presentStudentIds: presentStudentIds,
                teacherId: currentTeacher?.id || null,
                notes: ''
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            alert(`✅ Attendance saved successfully!\n\n📅 ${new Date(date).toLocaleDateString()}\n✅ Present: ${data.presentCount}\n❌ Absent: ${data.absentCount}`);
            document.getElementById('attendanceStatus').textContent = 
                `✅ Saved: ${data.presentCount} present, ${data.absentCount} absent`;
            
            // Reload history
            loadAttendanceHistory(selectedClassId, date);
        } else {
            alert('❌ Error saving attendance: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error submitting attendance:', error);
        alert('❌ Network error. Please try again.');
    } finally {
        if (submitBtn) {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
        }
    }
}

// ==================== SWEEPING ROSTER TAB ====================
async function loadSweepingRosterTab(classId) {
    const container = document.getElementById('classTabContent');
    container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
            <i class="fas fa-broom text-4xl mb-3 text-gray-300"></i>
            <p class="font-medium">Sweeping Roster</p>
            <p class="text-sm">Coming soon...</p>
        </div>
    `;
}

// ==================== HOMEWORK TAB ====================
async function loadHomeworkTab(classId) {
    const container = document.getElementById('classTabContent');
    container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
            <i class="fas fa-book text-4xl mb-3 text-gray-300"></i>
            <p class="font-medium">Homework Assignments</p>
            <p class="text-sm">Coming soon...</p>
        </div>
    `;
}

// ==================== LOGOUT ====================
async function logoutTeacher() {
    try {
        await fetch('/api/teachers/logout', { method: 'POST' });
        localStorage.removeItem('teacherSession');
        window.location.href = '/teacher-login.html';
    } catch (error) {
        console.error('Logout failed:', error);
        localStorage.removeItem('teacherSession');
        window.location.href = '/teacher-login.html';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initTeacherDashboard);

// Make functions global for inline onclick handlers
window.selectAllStudents = selectAllStudents;
window.deselectAllStudents = deselectAllStudents;
window.loadAttendanceForDate = loadAttendanceForDate;
window.submitAttendance = submitAttendance;
window.loadAttendanceForDateFromHistory = loadAttendanceForDateFromHistory;
window.logoutTeacher = logoutTeacher;

console.log('✅ Teacher Class Management loaded');