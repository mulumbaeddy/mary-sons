// Supabase Configuration
const SUPABASE_CONFIG = {
    url: 'https://hzcerknknjruutaeeugv.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6Y2Vya25rbmpydXV0YWVldWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODQ1MDMsImV4cCI6MjA5MzQ2MDUwM30.vhvWQxx00N76p0pRrOGbGbMXhRUl5hTGTmt07dlZY40'
};

// App Configuration
const APP_CONFIG = {
    name: 'Mary & Family Inventory',
    version: '1.0.0',
    lowStockThreshold: 5,
    autoRefreshInterval: 30000 // 30 seconds
};

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);