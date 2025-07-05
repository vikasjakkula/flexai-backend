const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://gywajswoztldhjdwepkv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5d2Fqc3dvenRsZGhqZHdlcGt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1NDI3OTIsImV4cCI6MjA2NDExODc5Mn0.W1K-UrncnN57sC5xqjwKE2OWc2WHvQqIQh0F-nCSFQI';

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase; 