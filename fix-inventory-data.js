// sync-inventory-from-payments.js
// Run with: node sync-inventory-from-payments.js

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const dataDir = path.join(__dirname, 'data');

function readFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        }
        return {};
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        return {};
    }
}

function saveFile(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
        return false;
    }
}

function isScholasticItem(componentName, itemName) {
    const componentLower = (componentName || '').toLowerCase();
    const itemLower = (itemName || '').toLowerCase();
    
    const scholasticKeywords = ['book', 'pen', 'pencil', 'rubber', 'eraser', 'ruler', 
                               'notebook', 'exercise', 'textbook', 'story', 'reader',
                               'chart', 'map', 'globe', 'calculator', 'set', 'compass',
                               'protractor', 'stapler', 'puncher', 'file', 'folder',
                               'binder', 'paper', 'ream', 'envelope', 'marker', 'crayon',
                               'paint', 'brush', 'clay', 'scissors', 'glue', 'tape',
                               'covers', 'toilet', 'broom', 'sugar', 'box file', 'clear bag',
                               'handwriting book', 'manila cards', 'cutters', 'inside brooms',
                               'sealed sugar', 'packet of crayons'];
    
    return scholasticKeywords.some(keyword => itemLower.includes(keyword) || componentLower.includes(keyword));
}

function syncInventoryFromPayments() {
    console.log('🔄 SYNCING INVENTORY FROM PAYMENTS...\n');
    
    const payments = readFile(path.join(dataDir, 'feePayments.json'));
    const stockPath = path.join(dataDir, 'inventoryStock.json');
    const transactionsPath = path.join(dataDir, 'inventoryTransactions.json');
    
    let stock = readFile(stockPath);
    let transactions = readFile(transactionsPath);
    
    let totalItemsAdded = 0;
    let totalPaymentsProcessed = 0;
    
    for (const payment of payments) {
        const academicYear = payment.academicYear;
        const term = payment.term;
        const studentId = payment.studentId;
        const studentName = payment.studentName || studentId;
        
        if (!academicYear || !term) continue;
        
        // Get activity items from payment
        const activityItems = payment.activityItemPayments || [];
        const periodItems = [];
        
        if (payment.paymentsByPeriodType) {
            for (const period of ['one_time', 'termly', 'yearly']) {
                const items = payment.paymentsByPeriodType[period] || [];
                periodItems.push(...items);
            }
        }
        
        const allItems = [...activityItems, ...periodItems];
        
        for (const item of allItems) {
            const itemName = item.itemName;
            const componentName = item.componentName || '';
            const periodType = item.periodType || 'termly';
            const unitPrice = item.unitPrice || 0;
            const quantityRequired = item.quantityRequired || 1;
            
            // Skip if not scholastic
            if (!isScholasticItem(componentName, itemName)) continue;
            
            let itemsToAdd = 0;
            
            if (item.paymentType === 'brought_item') {
                itemsToAdd = item.itemsBrought || 0;
            } else if (item.paymentType === 'paid_cash') {
                if (unitPrice > 0) {
                    itemsToAdd = Math.floor((item.amountPaid || 0) / unitPrice);
                } else if (item.amountPaid > 0) {
                    itemsToAdd = quantityRequired;
                }
            }
            
            if (itemsToAdd <= 0) continue;
            
            const cappedItems = Math.min(itemsToAdd, quantityRequired);
            const stockKey = `${itemName}_${academicYear}_${term}`;
            
            if (!stock[stockKey]) {
                stock[stockKey] = {
                    name: itemName,
                    academicYear: parseInt(academicYear),
                    term: parseInt(term),
                    totalReceived: 0,
                    issued: 0,
                    available: 0,
                    lastUpdated: new Date().toISOString()
                };
            }
            
            stock[stockKey].totalReceived = (stock[stockKey].totalReceived || 0) + cappedItems;
            stock[stockKey].available = (stock[stockKey].available || 0) + cappedItems;
            stock[stockKey].lastUpdated = new Date().toISOString();
            
            // Check for duplicate transaction
            const existingTx = transactions.find(t => 
                t.studentId === studentId && 
                t.itemName === itemName && 
                t.periodKey === `${academicYear}_${term}` &&
                t.autoAdded === true
            );
            
            if (!existingTx) {
                const transaction = {
                    id: uuidv4(),
                    itemName: itemName,
                    quantity: cappedItems,
                    transactionType: 'receipt',
                    destination: 'Inventory',
                    recipient: `Student: ${studentName}`,
                    comment: `Synced from existing payment - ${item.paymentType}`,
                    stockBefore: stock[stockKey].available - cappedItems,
                    stockAfter: stock[stockKey].available,
                    periodKey: `${academicYear}_${term}`,
                    academicYear: parseInt(academicYear),
                    term: parseInt(term),
                    studentId: studentId,
                    timestamp: new Date().toISOString(),
                    date: new Date().toISOString().split('T')[0],
                    isInventory: true,
                    autoAdded: true,
                    syncedFromPayment: true
                };
                
                transactions.push(transaction);
                totalItemsAdded += cappedItems;
                console.log(`✅ ${itemName}: +${cappedItems} items (${studentName})`);
            }
        }
        
        totalPaymentsProcessed++;
    }
    
    saveFile(stockPath, stock);
    saveFile(transactionsPath, transactions);
    
    console.log(`\n========================================`);
    console.log(`✅ Processed ${totalPaymentsProcessed} payments`);
    console.log(`📦 Added ${totalItemsAdded} items to stock`);
    console.log(`========================================\n`);
}

syncInventoryFromPayments();