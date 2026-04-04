require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('Starting DB wipe...');
  let { error: mErr } = await supabase.from('messages').delete().neq('owner_user_id', '00000000-0000-0000-0000-000000000000');
  console.log('Wiped messages?', mErr || 'Yes');
  let { error: cErr } = await supabase.from('customers').delete().neq('owner_user_id', '00000000-0000-0000-0000-000000000000');
  console.log('Wiped customers?', cErr || 'Yes');
  
  let { error: pErr } = await supabase.from('whatsapp_profiles').update({ history_sync_days: 1 }).neq('owner_user_id', '00000000-0000-0000-0000-000000000000');
  console.log('Set history sync to 1 day?', pErr || 'Yes');
  
  process.exit(0);
}

run();
