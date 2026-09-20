import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://fvufuibsfqgqicpgkihn.supabase.co";
const supabaseAnonKey = "sb_publishable_KfBxo5OAmW4SK-sYZ_eMrw_0K7XB8JM";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
