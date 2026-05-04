// Global variables
let currentUser = null;
let productsTable = null;
let transactionsTable = null;

// ============= AUTHENTICATION FUNCTIONS =============

// Login function
async function login() {
    const email = $('#loginEmail').val();
    const password = $('#loginPassword').val();
    
    if (!email || !password) {
        showNotification('Please enter both email and password', 'error');
        return;
    }
    
    showLoading();
    
    // For demo purposes, we'll create users if they don't exist
    // In production, you should have predefined users in Supabase Auth
    
    try {
        // Try to sign in
        let { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) {
            // If user doesn't exist, create them (first time setup)
            if (error.message.includes('Invalid login credentials')) {
                const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
                    email: email,
                    password: password,
                    options: {
                        data: {
                            full_name: email.split('@')[0],
                            role: 'admin'
                        }
                    }
                });
                
                if (signUpError) {
                    showNotification('Login failed: ' + signUpError.message, 'error');
                    hideLoading();
                    return;
                }
                
                showNotification('Account created! Please login again.', 'success');
                hideLoading();
                return;
            } else {
                showNotification('Login failed: ' + error.message, 'error');
                hideLoading();
                return;
            }
        }
        
        if (data.user) {
            currentUser = data.user;
            localStorage.setItem('inventory_user', JSON.stringify({
                id: currentUser.id,
                email: currentUser.email
            }));
            showNotification('Login successful! Welcome back!', 'success');
            $('#loginModal').modal('hide');
            loadDashboard();
        }
    } catch (error) {
        showNotification('Login error: ' + error.message, 'error');
    }
    
    hideLoading();
}

// Logout function
async function logout() {
    await supabase.auth.signOut();
    currentUser = null;
    localStorage.removeItem('inventory_user');
    showNotification('Logged out successfully', 'success');
    $('#mainContent').hide();
    $('.navbar-custom').hide();
    showLoginPrompt();
}

// Check if user is already logged in
async function checkAuth() {
    const savedUser = localStorage.getItem('inventory_user');
    if (savedUser) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            currentUser = user;
            loadDashboard();
            return true;
        }
    }
    showLoginPrompt();
    return false;
}

// Show login prompt
function showLoginPrompt() {
    $('#loginModal').modal({
        backdrop: 'static',
        keyboard: false
    });
    $('#loginModal').modal('show');
    $('#mainContent').hide();
    $('.navbar-custom').hide();
}

// Load main dashboard
async function loadDashboard() {
    $('#loginModal').modal('hide');
    $('#mainContent').show();
    $('.navbar-custom').show();
    $('#userEmail').text(currentUser?.email || 'Family Member');
    
    await Promise.all([
        loadProducts(),
        loadTransactions(),
        loadStats()
    ]);
}

// ============= INVENTORY FUNCTIONS =============

// Load products
async function loadProducts() {
    showTableLoading('#productsTableBody');
    
    const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error('Error loading products:', error);
        showNotification('Error loading products', 'error');
        return;
    }
    
    let html = '';
    products.forEach(product => {
        const totalValue = product.quantity * product.unit_price;
        const isLowStock = product.quantity <= (product.min_stock_level || APP_CONFIG.lowStockThreshold);
        
        html += `
            <tr>
                <td><strong>${escapeHtml(product.name)}</strong></td>
                <td><span class="badge bg-secondary">${escapeHtml(product.category || 'Uncategorized')}</span></td>
                <td class="${isLowStock ? 'low-stock-text' : ''}">
                    <span class="quantity-badge ${isLowStock ? 'bg-danger' : 'bg-success'}">
                        ${product.quantity}
                    </span>
                </td>
                <td>$${product.unit_price?.toFixed(2) || '0.00'}</td>
                <td>$${totalValue.toFixed(2)}</td>
                <td>
                    ${isLowStock ? 
                        '<span class="status-badge status-low"><i class="fas fa-exclamation-triangle"></i> Low Stock</span>' : 
                        '<span class="status-badge status-good"><i class="fas fa-check-circle"></i> In Stock</span>'}
                </td>
                <td>
                    <button class="btn-action btn-update" onclick="openUpdateStockModal(${product.id}, '${escapeHtml(product.name)}', ${product.quantity})" title="Update Stock">
                        <i class="fas fa-exchange-alt"></i>
                    </button>
                    <button class="btn-action btn-delete" onclick="deleteProduct(${product.id})" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
    
    $('#productsTableBody').html(html);
    
    if (productsTable) {
        productsTable.destroy();
    }
    productsTable = $('#productsTable').DataTable({
        pageLength: 10,
        order: [[2, 'asc']],
        language: {
            search: "Search products:",
            lengthMenu: "Show _MENU_ products per page",
            info: "Showing _START_ to _END_ of _TOTAL_ products"
        }
    });
}

// Load transactions
async function loadTransactions() {
    showTableLoading('#transactionsTableBody');
    
    const { data: transactions, error } = await supabase
        .from('stock_transactions')
        .select('*, products(name)')
        .order('transaction_date', { ascending: false })
        .limit(100);
    
    if (error) {
        console.error('Error loading transactions:', error);
        return;
    }
    
    let html = '';
    transactions.forEach(trans => {
        html += `
            <tr>
                <td><i class="far fa-calendar-alt"></i> ${new Date(trans.transaction_date).toLocaleString()}</td>
                <td><strong>${escapeHtml(trans.products?.name || 'Unknown')}</strong></td>
                <td>
                    <span class="transaction-badge ${trans.transaction_type === 'IN' ? 'bg-success' : 'bg-warning'}">
                        <i class="fas ${trans.transaction_type === 'IN' ? 'fa-arrow-down' : 'fa-arrow-up'}"></i>
                        ${trans.transaction_type === 'IN' ? 'Stock In' : 'Stock Out'}
                    </span>
                </td>
                <td class="text-center"><span class="quantity-change">${trans.transaction_type === 'IN' ? '+' : '-'}${trans.quantity}</span></td>
                <td>${escapeHtml(trans.notes || '-')}</td>
            </tr>
        `;
    });
    
    $('#transactionsTableBody').html(html);
    
    if (transactionsTable) {
        transactionsTable.destroy();
    }
    transactionsTable = $('#transactionsTable').DataTable({
        pageLength: 10,
        order: [[0, 'desc']],
        language: {
            search: "Search transactions:"
        }
    });
}

// Load statistics
async function loadStats() {
    const { data: products, error } = await supabase
        .from('products')
        .select('quantity, unit_price, min_stock_level');
    
    if (error) {
        console.error('Error loading stats:', error);
        return;
    }
    
    const totalProducts = products.length;
    const lowStockCount = products.filter(p => p.quantity <= (p.min_stock_level || APP_CONFIG.lowStockThreshold)).length;
    const totalValue = products.reduce((sum, p) => sum + (p.quantity * p.unit_price), 0);
    
    // Animate counter
    animateNumber('totalProducts', totalProducts);
    animateNumber('lowStockCount', lowStockCount);
    animateNumber('totalValue', totalValue);
    
    // Get unique categories
    const { data: categories } = await supabase
        .from('products')
        .select('category');
    
    const uniqueCategories = [...new Set(categories?.map(c => c.category).filter(c => c && c.trim()))];
    $('#totalCategories').text(uniqueCategories.length);
}

// Animate number counter
function animateNumber(elementId, targetValue) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    let currentValue = 0;
    const duration = 1000;
    const stepTime = 20;
    const steps = duration / stepTime;
    const increment = targetValue / steps;
    
    const counter = setInterval(() => {
        currentValue += increment;
        if (currentValue >= targetValue) {
            element.textContent = elementId === 'totalValue' ? '$' + targetValue.toFixed(2) : Math.round(targetValue);
            clearInterval(counter);
        } else {
            element.textContent = elementId === 'totalValue' ? '$' + currentValue.toFixed(2) : Math.round(currentValue);
        }
    }, stepTime);
}

// Add product
async function addProduct() {
    const productData = {
        name: $('#productName').val(),
        category: $('#productCategory').val(),
        quantity: parseInt($('#productQuantity').val()) || 0,
        unit_price: parseFloat($('#productPrice').val()) || 0,
        min_stock_level: parseInt($('#minStockLevel').val()) || APP_CONFIG.lowStockThreshold,
        description: $('#productDescription').val(),
        created_at: new Date(),
        updated_at: new Date()
    };
    
    if (!productData.name || !productData.category) {
        showNotification('Please fill in product name and category', 'error');
        return;
    }
    
    showLoading();
    
    const { data, error } = await supabase
        .from('products')
        .insert([productData])
        .select();
    
    if (error) {
        showNotification('Error adding product: ' + error.message, 'error');
        hideLoading();
        return;
    }
    
    showNotification('Product added successfully!', 'success');
    $('#addProductModal').modal('hide');
    $('#addProductForm')[0].reset();
    await loadProducts();
    await loadStats();
    hideLoading();
}

// Update stock
async function updateStock() {
    const productId = $('#updateProductId').val();
    const transactionType = $('#transactionType').val();
    const changeQty = parseInt($('#changeQuantity').val());
    const notes = $('#transactionNotes').val();
    
    if (isNaN(changeQty) || changeQty <= 0) {
        showNotification('Please enter a valid quantity', 'error');
        return;
    }
    
    showLoading();
    
    // Get current product
    const { data: product, error: fetchError } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .single();
    
    if (fetchError) {
        showNotification('Error fetching product', 'error');
        hideLoading();
        return;
    }
    
    let newQuantity = product.quantity;
    if (transactionType === 'IN') {
        newQuantity += changeQty;
    } else {
        newQuantity -= changeQty;
    }
    
    if (newQuantity < 0) {
        showNotification('Stock cannot be negative!', 'error');
        hideLoading();
        return;
    }
    
    // Update product quantity
    const { error: updateError } = await supabase
        .from('products')
        .update({ quantity: newQuantity, updated_at: new Date() })
        .eq('id', productId);
    
    if (updateError) {
        showNotification('Error updating stock', 'error');
        hideLoading();
        return;
    }
    
    // Record transaction
    const transactionData = {
        product_id: parseInt(productId),
        transaction_type: transactionType,
        quantity: changeQty,
        previous_quantity: product.quantity,
        new_quantity: newQuantity,
        notes: notes,
        transaction_date: new Date()
    };
    
    await supabase.from('stock_transactions').insert([transactionData]);
    
    showNotification('Stock updated successfully!', 'success');
    $('#updateStockModal').modal('hide');
    await loadProducts();
    await loadTransactions();
    await loadStats();
    hideLoading();
}

// Delete product
async function deleteProduct(id) {
    if (!confirm('⚠️ Are you sure you want to delete this product? This action cannot be undone.')) {
        return;
    }
    
    showLoading();
    
    const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);
    
    if (error) {
        showNotification('Error deleting product: ' + error.message, 'error');
        hideLoading();
        return;
    }
    
    showNotification('Product deleted successfully!', 'success');
    await loadProducts();
    await loadStats();
    hideLoading();
}

// ============= UI HELPER FUNCTIONS =============

// Open modals
function openAddProductModal() {
    $('#addProductForm')[0].reset();
    $('#addProductModal').modal('show');
}

function openUpdateStockModal(id, name, currentQty) {
    $('#updateProductId').val(id);
    $('#updateProductName').val(name);
    $('#currentQuantity').val(currentQty);
    $('#changeQuantity').val('');
    $('#transactionNotes').val('');
    $('#transactionType').val('IN');
    $('#updateStockModal').modal('show');
}

// Show notification
function showNotification(message, type = 'success') {
    const toast = `
        <div class="notification-toast notification-${type}">
            <i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>
            <span>${message}</span>
        </div>
    `;
    $('body').append(toast);
    setTimeout(() => {
        $('.notification-toast').fadeOut(() => $(this).remove());
    }, 3000);
}

// Show loading
function showLoading() {
    $('#loadingOverlay').fadeIn();
}

function hideLoading() {
    $('#loadingOverlay').fadeOut();
}

function showTableLoading(elementId) {
    $(elementId).html(`
        <tr>
            <td colspan="10" class="text-center">
                <div class="loader"></div>
                <p class="text-muted mt-2">Loading data...</p>
            </td>
        </tr>
    `);
}

// Escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Auto refresh
setInterval(() => {
    if (currentUser && $('#mainContent').is(':visible')) {
        loadProducts();
        loadTransactions();
        loadStats();
    }
}, APP_CONFIG.autoRefreshInterval);

// Initialize on page load
$(document).ready(function() {
    checkAuth();
});