import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
  const { data, error } = await supabase.auth.admin.updateUserById(
    '3aea1038-181a-492c-abd7-af9ed7c6e18f',
    {
      email: 'khaled.tawfiq2111@gmail.com',
      password: '@Mira260211SSddaa'
    }
  );

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
  console.log('Updated user:', data.user?.email);
}

main();
