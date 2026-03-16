import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://txhyfogbyzwueazhrqax.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR4aHlmb2dieXp3dWVhemhycWF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0MzI5MzcsImV4cCI6MjA4OTAwODkzN30.XYaUiGtgutQVsYpNekLuLJ8LHVlWZhRtRnAvL7_IAfQ'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
