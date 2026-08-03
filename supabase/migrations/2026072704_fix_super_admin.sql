-- تعيين topone1.com@gmail.com كـ super_admin
-- نفّذ هذا في SQL Editor أولاً

INSERT INTO user_roles (user_id, role_id, workspace_id)
SELECT p.user_id, r.id, p.workspace_id
FROM profiles p
CROSS JOIN roles r
WHERE p.email = 'topone1.com@gmail.com'
  AND r.key = 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.user_id = p.user_id
      AND ur.role_id = r.id
  );
