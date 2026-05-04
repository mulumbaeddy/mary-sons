<?php
require_once 'config.php';

// Handle AJAX requests
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_SERVER['HTTP_X_REQUESTED_WITH'])) {
    header('Content-Type: application/json');
    
    $action = $_POST['action'] ?? '';
    
    switch ($action) {
        case 'add_product':
            $data = [
                'name' => $_POST['name'],
                'category_id' => (int)$_POST['category_id'],
                'quantity' => (int)$_POST['quantity'],
                'unit_price' => (float)$_POST['unit_price'],
                'min_stock_level' => (int)$_POST['min_stock_level'],
                'sku' => $_POST['sku'],
                'description' => $_POST['description']
            ];
            $result = $db->insert('products', $data);
            echo json_encode(['success' => $result['status'] === 201]);
            break;
            
        case 'update_stock':
            $product_id = (int)$_POST['product_id'];
            $quantity_change = (int)$_POST['quantity_change'];
            $type = $_POST['type'];
            
            // Get current product
            $product = $db->getById('products', $product_id);
            if ($product) {
                $old_qty = $product['quantity'];
                $new_qty = $type === 'IN' ? $old_qty + $quantity_change : $old_qty - $quantity_change;
                
                // Update product quantity
                $db->update('products', $product_id, ['quantity' => $new_qty]);
                
                // Record transaction
                $db->insert('stock_transactions', [
                    'product_id' => $product_id,
                    'transaction_type' => $type,
                    'quantity' => $quantity_change,
                    'previous_quantity' => $old_qty,
                    'new_quantity' => $new_qty,
                    'notes' => $_POST['notes'] ?? ''
                ]);
                
                echo json_encode(['success' => true, 'new_quantity' => $new_qty]);
            }
            break;
            
        case 'delete_product':
            $result = $db->delete('products', (int)$_POST['product_id']);
            echo json_encode(['success' => $result['status'] === 204]);
            break;
    }
    exit;
}

// Get all data for display
$products = $db->getAll('products', '*, categories(name)');
$categories = $db->getAll('categories');
$suppliers = $db->getAll('suppliers');
$transactions = $db->getAll('stock_transactions', '*, products(name)');
?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mary and Family - Inventory System</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.datatables.net/1.11.5/css/dataTables.bootstrap5.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        :root {
            --primary: #667eea;
            --secondary: #764ba2;
            --success: #10b981;
            --warning: #f59e0b;
            --danger: #ef4444;
        }
        
        body {
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        .navbar {
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .navbar-brand {
            font-size: 1.8rem;
            font-weight: bold;
        }
        
        .stats-card {
            background: white;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            transition: transform 0.3s;
        }
        
        .stats-card:hover {
            transform: translateY(-5px);
        }
        
        .stats-icon {
            font-size: 2.5rem;
            color: var(--primary);
        }
        
        .low-stock {
            background-color: #fee2e2;
            color: #dc2626;
            font-weight: bold;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            border: none;
        }
        
        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .table-container {
            background: white;
            border-radius: 15px;
            padding: 20px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
        }
        
        .modal-header {
            background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: white;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .fade-in {
            animation: fadeIn 0.5s ease-out;
        }
    </style>
</head>
<body>
    <!-- Navigation -->
    <nav class="navbar navbar-dark">
        <div class="container-fluid">
            <a class="navbar-brand" href="#">
                <i class="fas fa-boxes me-2"></i>
                Mary and Family Inventory System
            </a>
            <div class="d-flex">
                <span class="text-white me-3">
                    <i class="fas fa-user"></i> Family Business
                </span>
            </div>
        </div>
    </nav>
    
    <div class="container mt-4">
        <!-- Stats Cards -->
        <div class="row mb-4 fade-in">
            <div class="col-md-3">
                <div class="stats-card">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="text-muted">Total Products</h6>
                            <h2 class="mb-0"><?php echo count($products); ?></h2>
                        </div>
                        <div class="stats-icon">
                            <i class="fas fa-box"></i>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stats-card">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="text-muted">Low Stock Items</h6>
                            <h2 class="mb-0" id="lowStockCount">0</h2>
                        </div>
                        <div class="stats-icon">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stats-card">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="text-muted">Categories</h6>
                            <h2 class="mb-0"><?php echo count($categories); ?></h2>
                        </div>
                        <div class="stats-icon">
                            <i class="fas fa-tags"></i>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="stats-card">
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="text-muted">Total Value</h6>
                            <h2 class="mb-0" id="totalValue">$0</h2>
                        </div>
                        <div class="stats-icon">
                            <i class="fas fa-dollar-sign"></i>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <!-- Tabs -->
        <ul class="nav nav-tabs mb-3" id="myTab" role="tablist">
            <li class="nav-item" role="presentation">
                <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#products" type="button" role="tab">
                    <i class="fas fa-box"></i> Products
                </button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" data-bs-toggle="tab" data-bs-target="#transactions" type="button" role="tab">
                    <i class="fas fa-history"></i> Transactions
                </button>
            </li>
            <li class="nav-item" role="presentation">
                <button class="nav-link" data-bs-toggle="tab" data-bs-target="#suppliers" type="button" role="tab">
                    <i class="fas fa-truck"></i> Suppliers
                </button>
            </li>
        </ul>
        
        <div class="tab-content">
            <!-- Products Tab -->
            <div class="tab-pane fade show active" id="products" role="tabpanel">
                <div class="table-container">
                    <div class="d-flex justify-content-between mb-3">
                        <h4><i class="fas fa-boxes"></i> Inventory List</h4>
                        <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#addProductModal">
                            <i class="fas fa-plus"></i> Add Product
                        </button>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-hover" id="productsTable">
                            <thead>
                                <tr>
                                    <th>SKU</th>
                                    <th>Product Name</th>
                                    <th>Category</th>
                                    <th>Quantity</th>
                                    <th>Unit Price</th>
                                    <th>Total Value</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($products as $product): ?>
                                <tr>
                                    <td><?php echo htmlspecialchars($product['sku'] ?? 'N/A'); ?></td>
                                    <td><?php echo htmlspecialchars($product['name']); ?></td>
                                    <td><?php echo htmlspecialchars($product['categories']['name'] ?? 'Uncategorized'); ?></td>
                                    <td class="<?php echo ($product['quantity'] <= $product['min_stock_level']) ? 'low-stock' : ''; ?>">
                                        <?php echo $product['quantity']; ?>
                                    </td>
                                    <td>$<?php echo number_format($product['unit_price'], 2); ?></td>
                                    <td>$<?php echo number_format($product['quantity'] * $product['unit_price'], 2); ?></td>
                                    <td>
                                        <?php if ($product['quantity'] <= $product['min_stock_level']): ?>
                                            <span class="badge bg-danger">Low Stock</span>
                                        <?php else: ?>
                                            <span class="badge bg-success">In Stock</span>
                                        <?php endif; ?>
                                    </td>
                                    <td>
                                        <button class="btn btn-sm btn-info" onclick="updateStock(<?php echo $product['id']; ?>, '<?php echo htmlspecialchars($product['name']); ?>', <?php echo $product['quantity']; ?>)">
                                            <i class="fas fa-exchange-alt"></i> Update Stock
                                        </button>
                                        <button class="btn btn-sm btn-danger" onclick="deleteProduct(<?php echo $product['id']; ?>)">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            
            <!-- Transactions Tab -->
            <div class="tab-pane fade" id="transactions" role="tabpanel">
                <div class="table-container">
                    <h4><i class="fas fa-history"></i> Stock Transaction History</h4>
                    <div class="table-responsive">
                        <table class="table table-hover" id="transactionsTable">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Product</th>
                                    <th>Type</th>
                                    <th>Quantity</th>
                                    <th>Previous Qty</th>
                                    <th>New Qty</th>
                                    <th>Notes</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($transactions as $transaction): ?>
                                <tr>
                                    <td><?php echo date('Y-m-d H:i', strtotime($transaction['transaction_date'])); ?></td>
                                    <td><?php echo htmlspecialchars($transaction['products']['name'] ?? 'N/A'); ?></td>
                                    <td>
                                        <span class="badge <?php echo $transaction['transaction_type'] == 'IN' ? 'bg-success' : 'bg-warning'; ?>">
                                            <?php echo $transaction['transaction_type']; ?>
                                        </span>
                                    </td>
                                    <td><?php echo $transaction['quantity']; ?></td>
                                    <td><?php echo $transaction['previous_quantity']; ?></td>
                                    <td><?php echo $transaction['new_quantity']; ?></td>
                                    <td><?php echo htmlspecialchars($transaction['notes'] ?? ''); ?></td>
                                </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            
            <!-- Suppliers Tab -->
            <div class="tab-pane fade" id="suppliers" role="tabpanel">
                <div class="table-container">
                    <div class="d-flex justify-content-between mb-3">
                        <h4><i class="fas fa-truck"></i> Supplier List</h4>
                        <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#addSupplierModal">
                            <i class="fas fa-plus"></i> Add Supplier
                        </button>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-hover" id="suppliersTable">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Contact Person</th>
                                    <th>Email</th>
                                    <th>Phone</th>
                                    <th>Address</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($suppliers as $supplier): ?>
                                <tr>
                                    <td><?php echo htmlspecialchars($supplier['name']); ?></td>
                                    <td><?php echo htmlspecialchars($supplier['contact_person'] ?? ''); ?></td>
                                    <td><?php echo htmlspecialchars($supplier['email'] ?? ''); ?></td>
                                    <td><?php echo htmlspecialchars($supplier['phone'] ?? ''); ?></td>
                                    <td><?php echo htmlspecialchars($supplier['address'] ?? ''); ?></td>
                                    <td>
                                        <button class="btn btn-sm btn-danger" onclick="deleteSupplier(<?php echo $supplier['id']; ?>)">
                                            <i class="fas fa-trash"></i>
                                        </button>
                                    </td>
                                </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Add Product Modal -->
    <div class="modal fade" id="addProductModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-plus"></i> Add New Product</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <form id="addProductForm">
                    <div class="modal-body">
                        <div class="mb-3">
                            <label>Product Name *</label>
                            <input type="text" name="name" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label>SKU</label>
                            <input type="text" name="sku" class="form-control" placeholder="Unique product code">
                        </div>
                        <div class="mb-3">
                            <label>Category *</label>
                            <select name="category_id" class="form-control" required>
                                <option value="">Select Category</option>
                                <?php foreach ($categories as $category): ?>
                                    <option value="<?php echo $category['id']; ?>"><?php echo htmlspecialchars($category['name']); ?></option>
                                <?php endforeach; ?>
                            </select>
                        </div>
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label>Initial Quantity</label>
                                <input type="number" name="quantity" class="form-control" value="0">
                            </div>
                            <div class="col-md-6 mb-3">
                                <label>Unit Price</label>
                                <input type="number" step="0.01" name="unit_price" class="form-control" value="0">
                            </div>
                        </div>
                        <div class="mb-3">
                            <label>Minimum Stock Level</label>
                            <input type="number" name="min_stock_level" class="form-control" value="5">
                        </div>
                        <div class="mb-3">
                            <label>Description</label>
                            <textarea name="description" class="form-control" rows="3"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary">Add Product</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    
    <!-- Update Stock Modal -->
    <div class="modal fade" id="updateStockModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-exchange-alt"></i> Update Stock</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <form id="updateStockForm">
                    <input type="hidden" name="product_id" id="stock_product_id">
                    <div class="modal-body">
                        <p><strong>Product:</strong> <span id="stock_product_name"></span></p>
                        <p><strong>Current Quantity:</strong> <span id="stock_current_qty"></span></p>
                        <div class="mb-3">
                            <label>Transaction Type</label>
                            <select name="type" class="form-control" required>
                                <option value="IN">Stock In (Add)</option>
                                <option value="OUT">Stock Out (Remove)</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label>Quantity</label>
                            <input type="number" name="quantity_change" class="form-control" required min="1">
                        </div>
                        <div class="mb-3">
                            <label>Notes</label>
                            <textarea name="notes" class="form-control" rows="2" placeholder="Reason for stock update..."></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary">Update Stock</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    
    <!-- Add Supplier Modal -->
    <div class="modal fade" id="addSupplierModal" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title"><i class="fas fa-truck"></i> Add Supplier</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <form id="addSupplierForm">
                    <div class="modal-body">
                        <div class="mb-3">
                            <label>Supplier Name *</label>
                            <input type="text" name="name" class="form-control" required>
                        </div>
                        <div class="mb-3">
                            <label>Contact Person</label>
                            <input type="text" name="contact_person" class="form-control">
                        </div>
                        <div class="mb-3">
                            <label>Email</label>
                            <input type="email" name="email" class="form-control">
                        </div>
                        <div class="mb-3">
                            <label>Phone</label>
                            <input type="text" name="phone" class="form-control">
                        </div>
                        <div class="mb-3">
                            <label>Address</label>
                            <textarea name="address" class="form-control" rows="2"></textarea>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="submit" class="btn btn-primary">Add Supplier</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
    
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js"></script>
    <script src="https://cdn.datatables.net/1.11.5/js/jquery.dataTables.min.js"></script>
    <script src="https://cdn.datatables.net/1.11.5/js/dataTables.bootstrap5.min.js"></script>
    
    <script>
        $(document).ready(function() {
            // Initialize DataTables
            $('#productsTable').DataTable({
                pageLength: 10,
                order: [[3, 'asc']] // Sort by quantity
            });
            $('#transactionsTable').DataTable();
            $('#suppliersTable').DataTable();
            
            // Calculate statistics
            calculateStats();
            
            // Add Product
            $('#addProductForm').on('submit', function(e) {
                e.preventDefault();
                $.post('index.php', $(this).serialize() + '&action=add_product', function(response) {
                    if (response.success) {
                        location.reload();
                    } else {
                        alert('Error adding product');
                    }
                }, 'json');
            });
            
            // Update Stock
            $('#updateStockForm').on('submit', function(e) {
                e.preventDefault();
                $.post('index.php', $(this).serialize() + '&action=update_stock', function(response) {
                    if (response.success) {
                        location.reload();
                    } else {
                        alert('Error updating stock');
                    }
                }, 'json');
            });
            
            // Add Supplier
            $('#addSupplierForm').on('submit', function(e) {
                e.preventDefault();
                // Implement supplier addition via Supabase
                alert('Supplier addition would be implemented here');
                location.reload();
            });
        });
        
        function updateStock(productId, productName, currentQty) {
            $('#stock_product_id').val(productId);
            $('#stock_product_name').text(productName);
            $('#stock_current_qty').text(currentQty);
            $('#updateStockModal').modal('show');
        }
        
        function deleteProduct(productId) {
            if (confirm('Are you sure you want to delete this product?')) {
                $.post('index.php', {action: 'delete_product', product_id: productId}, function(response) {
                    if (response.success) {
                        location.reload();
                    } else {
                        alert('Error deleting product');
                    }
                }, 'json');
            }
        }
        
        function deleteSupplier(supplierId) {
            if (confirm('Are you sure you want to delete this supplier?')) {
                // Implement supplier deletion
                alert('Supplier deletion would be implemented here');
            }
        }
        
        function calculateStats() {
            // Calculate low stock count
            let lowStock = 0;
            let totalValue = 0;
            
            <?php foreach ($products as $product): ?>
                if (<?php echo $product['quantity']; ?> <= <?php echo $product['min_stock_level']; ?>) {
                    lowStock++;
                }
                totalValue += <?php echo $product['quantity'] * $product['unit_price']; ?>;
            <?php endforeach; ?>
            
            $('#lowStockCount').text(lowStock);
            $('#totalValue').text('$' + totalValue.toFixed(2));
        }
    </script>
</body>
</html>