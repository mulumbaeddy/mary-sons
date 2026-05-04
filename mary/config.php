<?php
// Supabase configuration
define('SUPABASE_URL', 'https://hzcerknknjruutaeeugv.supabase.co');
define('SUPABASE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh6Y2Vya25rbmpydXV0YWVldWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4ODQ1MDMsImV4cCI6MjA5MzQ2MDUwM30.vhvWQxx00N76p0pRrOGbGbMXhRUl5hTGTmt07dlZY40');

// Database connection using Supabase Rest API
class SupabaseDB {
    private $url;
    private $key;
    
    public function __construct() {
        $this->url = SUPABASE_URL;
        $this->key = SUPABASE_KEY;
    }
    
    private function request($method, $endpoint, $data = null) {
        $ch = curl_init();
        $full_url = $this->url . $endpoint;
        
        curl_setopt($ch, CURLOPT_URL, $full_url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'apikey: ' . $this->key,
            'Authorization: Bearer ' . $this->key,
            'Content-Type: application/json',
            'Prefer: return=representation'
        ]);
        
        if ($data) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
        }
        
        $response = curl_exec($ch);
        $http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        
        return [
            'status' => $http_code,
            'data' => json_decode($response, true)
        ];
    }
    
    public function getAll($table, $select = '*') {
        $result = $this->request('GET', "/rest/v1/{$table}?select={$select}");
        return $result['data'];
    }
    
    public function getById($table, $id) {
        $result = $this->request('GET', "/rest/v1/{$table}?id=eq.{$id}");
        return $result['data'][0] ?? null;
    }
    
    public function insert($table, $data) {
        return $this->request('POST', "/rest/v1/{$table}", $data);
    }
    
    public function update($table, $id, $data) {
        return $this->request('PATCH', "/rest/v1/{$table}?id=eq.{$id}", $data);
    }
    
    public function delete($table, $id) {
        return $this->request('DELETE', "/rest/v1/{$table}?id=eq.{$id}");
    }
}

$db = new SupabaseDB();
session_start();
?>