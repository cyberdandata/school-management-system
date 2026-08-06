// clean-existing-data.js
// Run with: node clean-existing-data.js

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const paymentsPath = path.join(dataDir, 'feePayments.json');

function cleanData() {
    console.log('\n🔧 CLEANING EXISTING PAYMENT DATA...\n');
    
    let payments = JSON.parse(fs.readFileSync(paymentsPath, 'utf8'));
    let totalFixed = 0;
    
    for (const payment of payments) {
        let paymentFixed = false;
        
        for (const period of ['one_time', 'termly', 'yearly']) {
            const items = payment.paymentsByPeriodType?.[period] || [];
            
            for (const item of items) {
                const hasCash = item.amountPaid && item.amountPaid > 0;
                const hasItems = item.itemsBrought && item.itemsBrought > 0;
                
                if (hasCash && hasItems) {
                    const cashValue = item.amountPaid;
                    const itemsValue = item.itemsBrought * item.unitPrice;
                    
                    console.log(`\n📝 Fixing ${item.itemName} for ${payment.studentName}:`);
                    console.log(`   Before: Cash=${cashValue}, Items=${item.itemsBrought}`);
                    
                    // CHOOSE ONLY ONE METHOD - keep the method with HIGHER value
                    if (cashValue >= itemsValue) {
                        // Keep cash, remove items
                        item.itemsBrought = 0;
                        item.paymentType = 'paid_cash';
                        console.log(`   After: Cash only = UGX ${cashValue}`);
                    } else {
                        // Keep items, remove cash
                        item.amountPaid = 0;
                        item.paymentType = 'brought_item';
                        console.log(`   After: Items only = ${item.itemsBrought} items (UGX ${itemsValue})`);
                    }
                    totalFixed++;
                    paymentFixed = true;
                }
            }
        }
        
        // Recalculate total if payment was fixed
        if (paymentFixed) {
            const tuitionPaid = payment.tuitionPaid || 0;
            let activityTotal = 0;
            
            for (const period of ['one_time', 'termly', 'yearly']) {
                const items = payment.paymentsByPeriodType?.[period] || [];
                for (const item of items) {
                    if (item.paymentType === 'paid_cash') {
                        activityTotal += item.amountPaid || 0;
                    } else if (item.paymentType === 'brought_item') {
                        activityTotal += (item.itemsBrought || 0) * item.unitPrice;
                    }
                }
            }
            
            payment.totalAmount = tuitionPaid + activityTotal;
        }
    }
    
    fs.writeFileSync(paymentsPath, JSON.stringify(payments, null, 2));
    
    console.log(`\n========================================`);
    console.log(`✅ FIXED ${totalFixed} items that had both cash and items`);
    console.log(`========================================\n`);
}

cleanData();