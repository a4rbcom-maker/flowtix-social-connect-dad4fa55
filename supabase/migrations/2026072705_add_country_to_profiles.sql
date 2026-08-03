-- إضافة عمود country لجدول profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country text DEFAULT NULL;
