---
description: رفع التغييرات إلى GitHub (add + commit + push)
argument-hint: [رسالة الـ commit اختيارية]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git branch:*), Bash(git remote:*), Bash(git log:*)
---

## الوضع الحالي للمستودع

- الحالة: !`git status --short`
- الفرع الحالي: !`git branch --show-current`
- المستودع البعيد: !`git remote -v`
- آخر التغييرات: !`git diff --stat`

## المطلوب

ارفع التغييرات الحالية إلى GitHub باتباع هذه الخطوات بالترتيب:

1. إذا لم يكن هناك مستودع بعيد (remote)، توقف وأخبرني بذلك بالعربي ولا تكمل.
2. إذا لم تكن هناك أي تغييرات، أخبرني أنه لا يوجد شيء لرفعه وتوقف.
3. نفّذ `git add -A`.
4. رسالة الـ commit:
   - إذا كتبتُ رسالة بعد الأمر، استخدمها كما هي: $ARGUMENTS
   - إذا لم أكتب شيئاً، اكتب رسالة قصيرة وواضحة بالإنجليزية تصف التغييرات بناءً على الـ diff.
5. نفّذ `git commit -m "الرسالة"`.
6. نفّذ `git push`. إذا كان الفرع جديداً وليس له upstream، استخدم `git push -u origin <اسم الفرع>`.
7. إذا فشل الـ push بسبب وجود تغييرات جديدة على GitHub، لا تستخدم `--force` أبداً. اشرح لي المشكلة بالعربي واقترح الحل.

في النهاية، أعطني ملخصاً قصيراً بالعربي: ما الملفات التي رُفعت، ورسالة الـ commit، واسم الفرع.