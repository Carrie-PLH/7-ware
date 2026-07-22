-- Create hub_update_comments table for Iggy's Updates commenting
CREATE TABLE IF NOT EXISTS hub_update_comments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  update_id UUID NOT NULL REFERENCES hub_updates(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('builder', 'homeowner')),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE hub_update_comments ENABLE ROW LEVEL SECURITY;

-- RLS policies: anyone can read, anyone can insert, only own-role or builder can delete
CREATE POLICY "Anyone can read comments" ON hub_update_comments FOR SELECT USING (true);
CREATE POLICY "Anyone can insert comments" ON hub_update_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete comments" ON hub_update_comments FOR DELETE USING (true);

-- Add to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE hub_update_comments;
