/* ============================================================
   help.js  â€”  Help Assistant & User Manual
   Loaded on every page via a <script> tag in the shared layout.
   ============================================================ */
'use strict';

var HELP_SECTIONS = [
  // â”€â”€ DASHBOARD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'dashboard', icon:'fa-tachometer-alt', color:'#4a90e2', title:'Dashboard',
    intro:'Your real-time overview of the entire system. Every number on the cards is clickable and opens the records behind that count.',
    items:[
      { q:'What are the four stat cards at the top?',
        a:'<b>Active Patients</b> â€” patients currently marked as active. <b>Pending RX</b> â€” prescription records with at least one workflow step still unchecked. <b>Total RX</b> â€” every RX record ever created in the date window. <b>Total Patients</b> â€” all patients including inactive ones. Clicking the number on any card opens a filtered pop-up showing exactly those records. The counts respect whatever date range you have selected.' },
      { q:'What counts as a "Pending" RX?',
        a:'An RX record is considered pending when one or more workflow steps have not been marked complete. As soon as all steps are checked off, the record drops out of the pending count automatically. You can see exactly which step is blocking each RX in the RX Action Report.' },
      { q:'RX Pipeline chart â€” reading the bars',
        a:'The horizontal bar chart shows how many RX records are currently "stuck" waiting at each workflow step. The longest bar is your process bottleneck. For example, if "Dispatched" is longest, it means many RX records are waiting to be dispatched. Hover any bar to see the exact number. This chart updates every time you apply a date filter.' },
      { q:'Date range filter â€” how to use it',
        a:'The <b>From</b> and <b>To</b> date fields at the top of the dashboard filter every stat and chart on the page. Leave both blank to see all-time data. Click <b>"Today"</b> to reset to just today. You can also type dates manually in YYYY-MM-DD format. The filter does NOT affect the Patients table â€” it only filters RX-based statistics.' },
      { q:'Active Patients vs Total Patients â€” the difference',
        a:'<b>Active Patients</b> is the count of patients whose record has "Active Patient" checked. <b>Total Patients</b> includes everyone ever added, including inactive patients and soft-deleted patients that have been restored. A patient becomes inactive when a staff member unchecks the "Active Patient" toggle in their edit form.' }
    ]
  },

  // â”€â”€ PATIENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'patients', icon:'fa-user-injured', color:'#6366f1', title:'Patients',
    intro:'The Patient list is the core of the system. From here you can add, edit, view RX history, write notes, and manage every patient record.',
    items:[
      { q:'Adding a new patient â€” required fields',
        a:'Click the <b>"+ Add Patient"</b> button at the top right. Required fields: <b>First Name</b>, <b>Last Name</b>, <b>Date of Birth</b>, and <b>Phone</b>. Optional but useful: Patient Code (your internal ID), Address, Service Date, Clinic, Patient Transport Company, and Pharmacy Transport Company. Click <b>Save</b>. Before saving, the system automatically checks for duplicate patients with the same first name, last name, and date of birth â€” if a duplicate is found, you will get a warning and the save will be blocked.' },
      { q:'Editing a patient and what gets recorded',
        a:'Click the <b>pencil icon âœï¸</b> on any patient row. The same form opens pre-filled with the current values. Change any field and click Save. <b>Every field that changes is automatically recorded in the Audit Log</b> with the old value and the new value, the user who made the change, and the exact timestamp. You can always go back and see the full history of any patient record.' },
      { q:'â­ Clicking the bold action word in the Audit Log',
        a:'This is the most powerful feature for tracking changes. In the <b>Audit Log</b> (/audit-log), each row has a bold colored word showing the type of action â€” for example <b>UPDATE</b>, <b>CREATE</b>, or <b>DELETE</b>. <b>Click directly on that bold word.</b> A detail panel expands below the row showing you a side-by-side comparison of every field that changed: the old value has a <span style="color:#dc3545;text-decoration:line-through">red strikethrough</span>, and the new value is highlighted in <span style="color:#16a34a">green</span>. Fields that did not change are shown greyed out for context. This works for patients, RX records, users, settings, API keys, workflow step completions â€” everything in the system.' },
      { q:'Patient Timeline â€” the vertical RX history view',
        a:'Click the <b>clock/timeline icon ðŸ•</b> on any patient row to open their dedicated history page at /patients/{id}/timeline. You will see every RX record ever created for this patient displayed as a vertical timeline, newest at the top. Each timeline card shows: the RX number, pharmacy, service date, all medications, all workflow steps with who completed each one and when, and a progress bar. You can click <b>"Expand All"</b> to open every card at once, or expand them individually. This page also shows the yellow viewer banner if someone else is also looking at the same patient.' },
      { q:'Clinical Notes â€” writing and reading notes',
        a:'Click the <b>clipboard/notes icon</b> on any patient row. A side panel opens showing all existing notes for that patient in chronological order. Type your note in the text box at the bottom and click <b>"Add Note"</b>. Notes are automatically stamped with the author name and exact date/time. Notes are read-only after submission â€” they cannot be edited. Only administrators can delete notes. This design ensures an accurate, tamper-evident care record.' },
      { q:'Printing a patient record',
        a:'Click the <b>print icon ðŸ–¨ï¸</b> on any patient row. A formatted print preview opens in a new modal or window showing the patient demographics, all RX records, and workflow progress in a clean printer-friendly layout. Use your browser\'s print dialog (Ctrl+P) to print or save as PDF.' },
      { q:'Soft delete â€” what happens when you delete a patient',
        a:'Patients are never permanently erased. Clicking the <b>red delete icon</b> on a patient row marks the patient as deleted and hides them from the main list â€” but the record still exists in the database. Administrators can restore a soft-deleted patient at any time. All the patient\'s RX records, notes, and audit history are preserved. This protects you from accidental data loss.' },
      { q:'Search and filters on the patient list',
        a:'The search bar at the top of the patient list filters in real time as you type. It matches against patient name, patient code, and phone number simultaneously. The <b>Status dropdown</b> lets you show Active only, Inactive only, or All patients. Click any <b>column header</b> to sort the table by that column (click again to reverse the sort direction). Use the <b>Rows per page</b> selector to control how many patients appear per page.' },
      { q:'ðŸ‘ï¸ Viewer banner â€” what it means when you see it',
        a:'If a colleague opens the same patient page or patient modal at the same time as you, a <b>yellow warning banner</b> appears at the top of the patient: "ðŸ‘ï¸ Maria Rodriguez is also viewing this patient." This is a <b>soft warning â€” it does NOT lock or block editing</b>. Both users can still edit freely. The banner is there to alert you that simultaneous edits might conflict, so you can coordinate. The banner shows the user\'s full name and how long ago they opened the record. It updates every 60 seconds and disappears automatically when they leave.' },
      { q:'Lock TTL â€” the 5-minute automatic expiry',
        a:'TTL means "Time To Live." When a user opens a patient page, the system records a "viewer lock" with a 5-minute expiry timer. As long as the user stays on the page, the browser sends a silent heartbeat signal every 60 seconds to renew the lock. If they close the tab, lose internet, or go idle for over 5 minutes, the lock expires and is removed automatically. This means the yellow banner disappears even if someone forgot to close a patient tab â€” you won\'t see a phantom "someone is viewing" warning for hours.' }
    ]
  },

  // â”€â”€ RX RECORDS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'rx', icon:'fa-prescription', color:'#22c55e', title:'RX Records',
    intro:'RX Records are prescription deliveries. Each is linked to a patient and tracked through your workflow steps until delivery is confirmed.',
    items:[
      { q:'Creating a new RX record',
        a:'Click <b>"+ Add RX Record"</b>. You must select: the <b>Patient</b> (type to search), <b>Pharmacy</b>, <b>Arrival Date</b>, and <b>Service Date</b>. Optionally add: Patient Transport Company, Pharmacy Transport Company, and one or more <b>Medications</b> (name, dosage, quantity). Click Save. The new RX starts at 0% progress with all workflow steps unchecked.' },
      { q:'Workflow step dots â€” reading the progress indicators',
        a:'On each RX row in the list, you will see a row of small colored circles â€” these are the workflow step dots. <b>Filled green dot = step completed.</b> <b>Empty grey dot = step not yet done.</b> The number of dots equals the total number of workflow steps configured in your system. Hover your mouse over any dot to see a tooltip with the step name, who completed it, and the date and time it was completed.' },
      { q:'Marking a workflow step as complete',
        a:'Expand an RX record by clicking on it or clicking the expand arrow. In the workflow section, each step has a checkbox or button next to it. Click the button to mark it complete. The system records your username and the current timestamp. If you are trying to mark a step but nothing happens, check that your user role has permission to edit RX records â€” Viewer role cannot complete steps.' },
      { q:'Undo last workflow step â€” correcting a mistake',
        a:'Every RX record has an <b>"Undo Last Step"</b> button that becomes active after at least one step has been completed. Clicking it reverses only the most recently completed step â€” it does not undo all steps. This is designed for simple corrections, like accidentally clicking the wrong step. The undo action is also logged in the Audit Log.' },
      { q:'RX record history â€” field-level change tracking',
        a:'Click the <b>History icon ðŸ•</b> on any RX record row. This opens the full change history for that specific RX: every save, every field that was edited, every workflow step completion, all with timestamps and user names. Click the <b>bold action word</b> on any history row to see the exact before and after values for that change.' },
      { q:'Medications â€” adding and editing',
        a:'When creating or editing an RX record, scroll down to the Medications section. Click <b>"+ Add Medication"</b>. Enter the medication name, dosage (e.g., "10mg"), and quantity. You can add multiple medications to a single RX. Medications appear in the patient timeline view and in the RX Action Report.' },
      { q:'Deleting and restoring an RX record',
        a:'Like patients, RX records are soft-deleted â€” they disappear from the main list but are not permanently removed. All the record\'s data, history, and audit trail are preserved. Administrators can restore deleted RX records. This protects against accidental deletion of prescription history.' }
    ]
  },

  // â”€â”€ REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'reports', icon:'fa-chart-bar', color:'#06b6d4', title:'Reports & Selective Filters',
    intro:'The Reports page gives you two fully filterable report views â€” Patient Report and RX Action Report â€” each with export, print, and email capabilities.',
    items:[
      { q:'Patient Report tab â€” what it shows',
        a:'The Patient Report shows a full table of all patients with columns for: Patient ID, First Name, Last Name, Date of Birth, Phone, Address, Service Date, Status (Active/Inactive), Clinic, Patient Transport, and Pharmacy Transport. All data loads automatically when you open the tab. Click any column header to sort the table in ascending or descending order.' },
      { q:'Selective filtering on the Patient Report',
        a:'Above the patient table are filter fields that let you narrow the results to exactly the patients you need. <b>Basic filters:</b> Patient ID (code), First Name, Last Name, Status (Active/Inactive/All). Type in any field and click the blue <b>Search</b> button. The table updates instantly to show only matching patients. The filter badge shows how many filters are active. Click the <b>X button</b> to clear all filters and return to the full list.' },
      { q:'Advanced Patient filters â€” phone, transport, clinic, date range',
        a:'Click the <b>"Advanced âŒ„"</b> toggle above the patient table to expand additional filter fields: <b>Phone</b> (partial match), <b>Transport</b> (transport company name), <b>Clinic</b> (clinic name), <b>Service From</b>, and <b>Service To</b> (date range for the Service Date field). You can combine basic and advanced filters together. For example: filter by Clinic = "Memorial" AND Status = "Active" AND Service From = "2025-01-01" to get all active patients at Memorial clinic seen this year.' },
      { q:'RX Action Report tab â€” what it shows',
        a:'The RX Action Report shows a table of all RX records with: RX Number, Patient name, Patient ID, Pharmacy, Service Date, Completed Steps (list of checked-off steps), Next Pending Step (the next step waiting to be done), and Progress (a percentage bar). This is the most useful report for operations â€” you can instantly see which RX records are stuck and at what step.' },
      { q:'Selective filtering on the RX Action Report',
        a:'<b>Basic filters:</b> RX # (record number), Patient First Name, Patient Last Name, Progress (All / Complete / Pending). Filter by <b>"Pending"</b> to see only RX records that still need work. Filter by <b>"Complete"</b> to see only fully delivered prescriptions. Click <b>Search</b> to apply, the <b>X</b> to clear.' },
      { q:'Advanced RX filters â€” Patient ID, pharmacy, date range',
        a:'Click <b>"Advanced âŒ„"</b> on the RX tab to expand: <b>Patient ID</b> (patient code), <b>Pharmacy</b> (partial name match), <b>Service From</b>, and <b>Service To</b> date fields. Combine these with the basic filters for very precise results. Example: "Show me all PENDING RX records for pharmacy \'CVS\' with service dates in the last 30 days."' },
      { q:'Sorting the report tables',
        a:'Click any column header in either report table to sort by that column. Click it again to reverse the sort direction (ascending vs descending). A small arrow icon appears on the active sort column showing the current direction. This works on all columns including Patient Name, Service Date, Status, and Progress.' },
      { q:'Exporting to CSV â€” what gets exported',
        a:'Click the green <b>"Export CSV"</b> button on either report tab. The exported file contains ALL rows matching your current filters â€” not just what is visible on the current page. Open it in Excel or Google Sheets. Column headers match the table exactly. Dates are exported in the format used by your system timezone setting.' },
      { q:'Printing a report',
        a:'Click the <b>print icon ðŸ–¨ï¸</b> on either report tab. The browser print dialog opens. The report is formatted for printing â€” page headers, borders, and table layout are all optimized for letter or A4 paper. If the table is very wide, use Landscape orientation in your printer settings.' },
      { q:'ðŸ“§ Email Report â€” sending a report by email',
        a:'Click the <b>"ðŸ“§ Email Report"</b> button in the top tab bar (it appears on both report tabs). A modal opens where you select: <b>Report Type</b> (Patient Report or RX Action Report), <b>Recipient Email(s)</b> (enter one or more addresses separated by commas), optional <b>Subject line</b>, and optional <b>date range</b> to filter the data. Click <b>"Test Connection"</b> first to make sure your SMTP is working, then click <b>"Send Report"</b>. The system generates the report in the background and sends it as a formatted HTML email. <b>SMTP must be configured first</b> in System Settings â†’ Email Setup.' }
    ]
  },

  // â”€â”€ WORKFLOW â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'workflow', icon:'fa-tasks', color:'#f59e0b', title:'Workflow Actions (Steps)',
    intro:'Workflow Actions are the named steps of your prescription delivery process. Every RX record is tracked against this list. Administrators configure the steps in Settings.',
    items:[
      { q:'What are Workflow Actions and why do they matter?',
        a:'Workflow Actions define the stages a prescription goes through from receipt to delivery. Examples: "Prescription Received", "Insurance Verified", "Medication Packaged", "Out for Delivery", "Delivered", "Patient Signature Obtained". Every RX record gets a copy of all workflow steps and tracks whether each one is complete. This gives you visibility into exactly where every prescription is in the process at any moment.' },
      { q:'Adding a new workflow step',
        a:'Go to <b>Settings â†’ Workflow Actions</b>. Click <b>"+ Add Step"</b>. Enter a name (required) and an optional description. Click Save. The new step immediately appears on all new RX records created after this point. Existing RX records that were created before are NOT affected â€” they keep the steps that existed when they were created.' },
      { q:'Editing or reordering steps',
        a:'In Settings â†’ Workflow Actions, you can edit the name and description of any step. Steps can be reordered by dragging them up or down â€” the order here determines the order the dots appear on RX records, left to right. Reordering only affects visual presentation, not the ability to complete steps in any order.' },
      { q:'Deleting a workflow step',
        a:'Deleting a step removes it from all future RX records. <b>Caution:</b> if existing RX records had this step, it will no longer appear in their workflow progress. This cannot be undone. It is usually better to rename a step than to delete it.' }
    ]
  },

  // â”€â”€ AUDIT LOG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'audit', icon:'fa-history', color:'#8b5cf6', title:'Audit Log',
    intro:'The Audit Log records every action by every user in the system. It is a complete, tamper-evident history. Only administrators and managers can access it.',
    items:[
      { q:'What does each audit log row tell you?',
        a:'Each row contains: <b>Timestamp</b> (date and time in your configured timezone), <b>User</b> (who performed the action), <b>Action Type</b> (CREATE / UPDATE / DELETE / LOGIN / LOGOUT / RESTORE etc.), <b>Module</b> (which part of the system was affected â€” Patients, RX Records, Users, Settings, etc.), <b>Record ID</b> (the specific record that was changed), and a <b>Summary</b> of what happened.' },
      { q:'â­ Clicking the bold action word â€” the full change diff',
        a:'This is the key feature of the audit log. Click directly on the bold colored action word (e.g., <b>UPDATE</b> or <b>CREATE</b>) in any row. A detail panel expands below that row. It shows a complete field-by-field breakdown of the change: every field that was modified, with the <span style="color:#dc3545;text-decoration:line-through">old value in red strikethrough</span> and the <span style="color:#16a34a">new value in green</span>. Fields that were not changed appear in grey for context. This works for every record type in the system â€” patients, RX records, users, settings, API keys, and workflow step completions. You can use this to answer "what exactly changed and when?"' },
      { q:'Filtering the audit log',
        a:'Use the filter bar at the top to narrow down entries: <b>Date From / Date To</b> â€” restrict to a time range. <b>User</b> dropdown â€” see only actions by a specific staff member. <b>Module</b> dropdown â€” see only changes to Patients, or only RX Records, etc. <b>Action Type</b> dropdown â€” show only CREATE, or only DELETE, etc. You can combine all four filters. Click <b>"Clear"</b> to reset everything. The filter badge shows how many filters are active.' },
      { q:'Who can see the audit log?',
        a:'Only users with the Administrator or Manager role can access /audit-log. Regular Staff and Viewer users are redirected if they try to access it directly. This is to protect sensitive change history from casual viewing.' },
      { q:'Bulk delete / rotating old entries',
        a:'Administrators can delete all audit entries older than a specific date using the <b>"Rotate"</b> function. This is useful for keeping the database size manageable over time. Rotated entries are permanently removed and cannot be recovered. A rotation itself creates a new audit entry recording that it happened and who did it.' }
    ]
  },

  // â”€â”€ USERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'users', icon:'fa-users-cog', color:'#ef4444', title:'User Management',
    intro:'Create and manage staff accounts. Each user gets a role that controls what they can see and do. Administrator access only.',
    items:[
      { q:'The four roles and what each can do',
        a:'<b>Administrator</b> â€” unrestricted access. Can manage users, system settings, API keys, audit log, and all patient/RX data. There should always be at least one Administrator. <b>Manager</b> â€” can view and edit all patient and RX records, run and email reports, view the audit log, but cannot manage users or change system settings. <b>Staff</b> â€” can add and edit patients and RX records, complete workflow steps, write notes, but cannot access reports, audit log, or settings. <b>Viewer</b> â€” read-only access to patient and RX records only. Cannot add, edit, delete, or complete workflow steps.' },
      { q:'Creating a new user',
        a:'Go to <b>Settings â†’ User Management</b>. Click <b>"+ Add User"</b>. Fill in: First Name, Last Name, Username (must be unique), Password (at least 8 characters), and select a Role. The user can log in immediately after being created. There is no email verification step.' },
      { q:'Changing a user\'s password',
        a:'Edit the user record. Type a new password in the Password field. If you leave the Password field blank, the existing password is kept unchanged. Passwords are stored using bcrypt hashing â€” not a single person in the system (including the database admin) can read the actual password. If a user forgets their password, an administrator must reset it.' },
      { q:'Deactivating / preventing login without deleting',
        a:'Currently, the way to prevent a user from logging in is to delete their account (soft-delete). Their name still appears in audit logs and history, and an administrator can restore the account later if needed. A full "Suspend" option (block login without deleting) can be requested as a future feature.' },
      { q:'Viewing what a user has done',
        a:'In the Audit Log, use the <b>User</b> filter dropdown to select a specific user and see every action they have taken. You can see exactly when they logged in, what records they created or edited, and even what fields they changed.' }
    ]
  },

  // â”€â”€ SETTINGS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'settings', icon:'fa-cog', color:'#64748b', title:'System Settings â€” General',
    intro:'System Settings are found at Settings â†’ System Settings. Only administrators can access this page. The General tab controls app-wide configuration.',
    items:[
      { q:'Application Name setting',
        a:'This is the name shown in the browser tab title, in the sidebar header, and in email report subjects. Change it to match your organization or clinic name. The change takes effect immediately without needing a server restart.' },
      { q:'Timezone â€” why it is critical',
        a:'The timezone setting controls how all dates and timestamps are displayed everywhere in the system â€” audit log entries, RX completion times, workflow step timestamps, report dates, and email timestamps. If your server is running in UTC (the default for most hosting) but your clinic is in Eastern time, every timestamp will appear 4 to 5 hours in the past without this setting. <b>Set this to your local city timezone as soon as the system is installed.</b> Example: "America/New_York" for Eastern US, "America/Chicago" for Central US, "America/Los_Angeles" for Pacific US.' },
      { q:'How the timezone change takes effect',
        a:'The timezone is stored in the database and loaded each time the server starts. After you save a new timezone, it applies to all new timestamps immediately. Old timestamps are stored in UTC internally and re-displayed in the new timezone â€” so existing audit log entries will also show the correct local time after you change the setting.' },
      { q:'Live clock â€” verifying the timezone',
        a:'On the General settings tab, a live clock shows you the current time in your selected timezone before you save. Use this to verify that the time matches your wall clock before committing the change.' }
    ]
  },

  // â”€â”€ EMAIL SETUP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'email', icon:'fa-envelope', color:'#6366f1', title:'System Settings â€” Email Setup',
    intro:'Configure outgoing email (SMTP) so the system can send reports. Once configured, email works from the Reports page without any further setup.',
    items:[
      { q:'Quick setup â€” choosing your provider',
        a:'Click your email provider\'s button at the top of the Email Setup tab: <b>Gmail</b>, <b>Outlook / Hotmail</b>, <b>Office 365</b>, <b>Yahoo Mail</b>, <b>Amazon SES</b>, or <b>SendGrid</b>. Clicking the button automatically fills in the SMTP server address and port number. You then only need to enter your email address and password/app password.' },
      { q:'Gmail â€” you MUST use an App Password',
        a:'Gmail does not allow your regular password to be used by external apps. You need a special <b>App Password</b>. Here is exactly how to get one: 1) Go to myaccount.google.com/security in your browser. 2) Make sure 2-Step Verification is enabled (you need this before App Passwords appear). 3) In the search bar on that page, search "App Passwords". 4) Click "App passwords". 5) Under "Select app" choose "Mail". Under "Select device" choose "Other" and type "Home Accounting". 6) Click "Generate". Google shows a 16-character code with spaces â€” copy it. 7) Paste the code into the Password field in Email Setup (spaces are fine). This app password replaces your regular Gmail password for this system.' },
      { q:'Outlook and Office 365',
        a:'For personal Outlook/Hotmail accounts, your regular password usually works with the Outlook SMTP settings. For Office 365 business accounts, check with your IT administrator â€” some organizations block SMTP authentication or require an app password through Azure Active Directory settings. If you get authentication errors, ask your IT team to enable "SMTP AUTH" for your account.' },
      { q:'Test Connection button â€” always test first',
        a:'After filling in your credentials and clicking Save, click the <b>"Test Connection"</b> button. The system tries to connect to your SMTP server and reports back: <b>green "Connected"</b> means it worked, <b>red error message</b> means something is wrong. Common error causes: wrong password (especially for Gmail â€” use App Password, not regular password), wrong port number, or firewall blocking the connection.' },
      { q:'Send Test Email â€” verify end-to-end delivery',
        a:'After the connection test passes, use the <b>"Send Test Email"</b> section at the bottom of the Email Setup tab. Enter any email address and click Send. The system sends a real HTML email with a test message. Check your inbox (and your spam/junk folder) within a minute. If the connection test passes but the email does not arrive, check spam filters.' },
      { q:'Security â€” how credentials are stored',
        a:'Email credentials are stored in the database in encrypted form. The password is never sent back to the browser â€” the settings form only shows a placeholder indicating a password is saved. The credentials survive server restarts because they are in the database, not in a config file or environment variable that could be lost.' }
    ]
  },

  // â”€â”€ API KEYS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'apikeys', icon:'fa-key', color:'#f59e0b', title:'System Settings â€” API Keys',
    intro:'API Keys allow external scripts, integrations, or automation to call the system API without logging in through the browser. Administrator access only.',
    items:[
      { q:'What is an API key and when do you need one?',
        a:'An API key is a secret token that proves to the server that a request is authorized. You need one when: a script needs to fetch patient or RX data automatically, you want to send daily reports via a scheduled job, you are integrating with another system like a spreadsheet or dashboard, or you are building a mobile app that talks to this server. Instead of username/password login, the script includes the key in every HTTP request header.' },
      { q:'How to use an API key in a request',
        a:'Add the header <code>X-API-Key: rxk_yourfullkeyhere</code> to every HTTP request. <br>Example with curl: <code>curl -H "X-API-Key: rxk_abc123..." http://localhost:3000/api/patients</code><br>Example with JavaScript fetch: <code>fetch("/api/patients", { headers: { "X-API-Key": "rxk_abc123..." } })</code><br>The server checks the key on every request and grants access based on the permissions associated with that key.' },
      { q:'Generating a new API key â€” step by step',
        a:'Go to <b>System Settings â†’ API Keys</b>. Click <b>"+ Generate New Key"</b>. Enter a descriptive name that explains what this key is for â€” for example "Daily Report Script", "Google Sheets Integration", or "Mobile App". Click Generate. <b>The full key is shown ONE TIME only in a modal.</b> Copy it immediately and store it in a secure location (a password manager, a .env file, an environment variable on your server). Once you close the modal, the full key cannot be retrieved again â€” only the first 12 characters are stored in the system for identification.' },
      { q:'âš ï¸ The key is shown ONCE â€” what happens if you lose it?',
        a:'The system stores only a SHA-256 hash of the key (a one-way fingerprint). This means even the database admin cannot read the original key. If you lose it, you have two options: 1) Delete the key and generate a new one, then update your script with the new key. 2) Keep the old key active but useless, and generate a second key for the script. Deleting a key is immediate and permanent â€” any script using it will start receiving 401 Unauthorized errors immediately.' },
      { q:'Enable and disable keys without deleting',
        a:'Each key row has a toggle switch. Flip it off to disable the key â€” all requests using that key will immediately get a 401 error. Flip it back on to re-enable it. This is useful if you suspect a key was leaked and want to temporarily block it while you investigate, without permanently revoking it.' },
      { q:'Show API Reference button',
        a:'Click <b>"Show API Reference"</b> in the API Keys section to see a live, auto-generated list of every API endpoint available in the system â€” currently 97 routes. Routes are grouped by category (Dashboard, Patients, RX Records, Users, Settings, etc.). Each row shows the HTTP method (GET/POST/PUT/DELETE), the URL path, a description of what it does, and the permission required. Click <b>"Copy URL"</b> on any row to copy the full endpoint URL. Click <b>"Refresh"</b> to reload the route list from the server â€” this is useful after system updates.' }
    ]
  },

  // â”€â”€ MULTI-USER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'multiuser', icon:'fa-users', color:'#22c55e', title:'Multi-User / Concurrent Access',
    intro:'The system is designed for multiple staff members to work simultaneously. Here is exactly how concurrent access is handled and what you can expect.',
    items:[
      { q:'Can two people use the system at the same time?',
        a:'Yes, fully. Multiple users can be logged in and working at the same time with no restrictions. Each user has their own browser session with their own authentication token. The server handles concurrent requests efficiently.' },
      { q:'Can two people edit the same patient at the same time?',
        a:'Yes â€” the system uses a <b>Soft Lock</b> model rather than a hard block. Both users can open and edit the same patient simultaneously. The system warns you with a yellow banner if another user has the patient open, but it does not prevent you from editing. This avoids the frustrating situation where someone locks a record and then walks away, preventing anyone else from working on it.' },
      { q:'What is the ðŸ‘ï¸ yellow viewer banner and what triggers it?',
        a:'When any user opens a patient page (either the timeline page or the edit modal), the system registers them as an active viewer of that patient. Any other user who opens the same patient within the next 5 minutes sees a yellow banner at the top saying: "ðŸ‘ï¸ [Name] is also viewing this patient â€” (opened 2 min ago)". If multiple users are viewing, the banner says "[Name1], [Name2] are also viewing" and shows a count badge.' },
      { q:'TTL â€” the 5-minute lock expiry in detail',
        a:'TTL = Time To Live. Every viewer registration has a 5-minute expiry timer. While the user stays on the patient page, their browser sends a silent HTTP request (called a heartbeat) every 60 seconds to renew the 5-minute timer. The timer resets to 5 minutes each time. If the heartbeat stops â€” because the tab was closed, the browser crashed, the network went down, or the user navigated to a different page â€” the timer counts down. After 5 minutes with no heartbeat, the lock is deleted and the viewer banner disappears for anyone else viewing that patient. This is why you will never see a banner saying someone has been "viewing" a patient for 3 hours â€” the maximum time is 5 minutes past when they actually left.' },
      { q:'What if two users save the same patient at the exact same time?',
        a:'The system uses "last write wins" â€” the last save overwrites any overlapping fields from the previous save. If User A and User B both open Patient John Smith, User A changes the phone number, User B changes the address, and they both save within seconds of each other â€” both changes will be recorded because they edited different fields. But if both edited the phone number, only the last save\'s value will be kept. The Audit Log records every save with the exact before/after values, so if there is a conflict you can always see what happened and manually correct it.' },
      { q:'How many users can use the system at once?',
        a:'There is no configured hard limit. The system runs on Node.js with a non-blocking architecture, which means it can handle dozens of concurrent users efficiently on modest server hardware. For a typical clinic with 5-20 simultaneous users on a local network server, performance will be very fast. Performance depends on your server\'s CPU, RAM, and database connection speed, not on any application-level limit.' }
    ]
  },

  // â”€â”€ IMPORT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'import', icon:'fa-file-import', color:'#0ea5e9', title:'Data Import',
    intro:'Import patients and other records in bulk using CSV files. Found under the Import section in the sidebar.',
    items:[
      { q:'How to import patients from a CSV file',
        a:'1) Go to the <b>Import</b> page from the sidebar. 2) Click <b>"Download Template"</b> for the Patients data type. This downloads a CSV with the exact column headers the system expects. 3) Open the CSV in Excel or Google Sheets and fill in your data. Do not rename, reorder, or delete any column headers. 4) Save the file as CSV format. 5) Back on the Import page, click <b>"Choose File"</b> and select your completed CSV. 6) Click <b>"Import"</b>. The system validates every row and shows you a results table with a green check for succeeded rows and a red X for failed rows with the specific reason (e.g., "Missing required field: Last Name" or "Duplicate patient: already exists").' },
      { q:'Required columns and date format',
        a:'Required columns for patient import: <b>firstName</b>, <b>lastName</b>, <b>dob</b> (date of birth), <b>phone</b>. Optional: patientCode, address, serviceDate, clinicName, isActive (true/false). <b>All dates must be in YYYY-MM-DD format</b> â€” for example 1985-03-15 for March 15, 1985. If you use MM/DD/YYYY format the import will fail on date fields.' },
      { q:'How duplicates are handled during import',
        a:'Before importing each row, the system checks if a patient with the same <b>first name + last name + date of birth</b> already exists. If a match is found, that row is skipped and reported as a warning (not a failure). The existing patient record is NOT modified. This prevents you from accidentally creating duplicate records during a re-import. Rows that are skipped as duplicates are listed in the results so you can review them.' },
      { q:'What happens to failed rows?',
        a:'Failed rows appear in the results table with a red indicator and a specific error message. The most common reasons for failure: a required field is blank, a date is in the wrong format, or a referenced value (like a clinic name) does not exist in the system. You can correct the failed rows in your CSV file and re-upload just those rows â€” the system will skip duplicates so you will not double-count the rows that already succeeded.' }
    ]
  },

  // â”€â”€ BACKUPS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    id:'backups', icon:'fa-database', color:'#8b5cf6', title:'Backups',
    intro:'The system automatically backs up the database on a schedule. Manual backups and downloads are also available from the Backups page.',
    items:[
      { q:'How automatic backups work',
        a:'The system runs a scheduled backup every night at <b>2:00 AM</b> in your configured timezone. Each backup creates a compressed SQL dump file in the <code>backups/</code> folder on the server. The backup is a complete snapshot of the entire database â€” all patients, RX records, audit logs, users, settings, and workflow data.' },
      { q:'Manual backup â€” triggering one immediately',
        a:'Go to the <b>Backups</b> page from the sidebar (Settings section). Click <b>"Run Backup Now"</b>. A new backup file is created within a few seconds. You will see it appear at the top of the backup file list with today\'s date and time. This is useful before making large data changes or system updates.' },
      { q:'Downloading a backup file',
        a:'On the Backups page, each backup appears in a list with its filename, date, and file size. Click the <b>"Download"</b> button next to any backup to save it to your computer. Store downloaded backup files in a secure off-site location â€” a USB drive kept in a different room, a cloud storage service, or a network file share. The on-server copies are protected by your server security, but a separate copy is essential for disaster recovery.' },
      { q:'How long to keep backups',
        a:'Best practice is to keep at minimum the last 7 daily backups and at least one backup per month for the past year. Delete older files from the server to save disk space. Always keep copies off-server. The Backups page shows how much total disk space all backup files are using.' },
      { q:'Restoring from a backup',
        a:'Restoring requires direct access to the server and the database. Contact your system administrator. The backup file is a standard SQL dump that can be restored using standard PostgreSQL tools (pg_restore or psql command). Plan for 5-30 minutes of downtime depending on the database size. Test restoration on a staging environment before you need to do it in an emergency.' }
    ]
  }
];

// â”€â”€â”€ CSS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
(function() {
  var s = document.createElement('style');
  s.textContent = [
    '#helpPanel{position:fixed;top:0;right:-530px;width:510px;height:100vh;',
      'background:var(--card-bg,#fff);z-index:99999;',
      'box-shadow:-8px 0 48px rgba(0,0,0,.18);display:flex;flex-direction:column;',
      'transition:right .35s cubic-bezier(.4,0,.2,1);',
      'border-left:1px solid var(--border-color,#dee2e6);}',
    '#helpPanel.open{right:0;}',
    '#helpOverlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.3);',
      'z-index:99998;backdrop-filter:blur(2px);}',
    '#helpOverlay.open{display:block;}',
    '.help-hdr{padding:16px 20px;background:linear-gradient(135deg,#1a3a5c,#4a90e2);',
      'color:#fff;display:flex;align-items:center;gap:12px;flex-shrink:0;}',
    '.help-hdr h2{margin:0;font-size:1.05rem;font-weight:700;letter-spacing:-.01em;}',
    '.help-hdr p{margin:0;font-size:.77rem;opacity:.85;}',
    '.help-srch{padding:10px 14px;border-bottom:1px solid var(--border-color,#e5e7eb);flex-shrink:0;}',
    '.help-srch input{width:100%;padding:8px 13px;border:1px solid var(--border-color,#dee2e6);',
      'border-radius:9px;font-size:.84rem;outline:none;',
      'background:var(--input-bg,#f8fafc);color:var(--text,#1e293b);}',
    '.help-srch input:focus{border-color:#4a90e2;box-shadow:0 0 0 3px rgba(74,144,226,.12);}',
    '.help-body{flex:1;overflow-y:auto;padding:12px 14px;}',
    '.help-pills{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:14px;}',
    '.hpill{padding:3px 10px;border-radius:20px;font-size:.71rem;font-weight:600;',
      'cursor:pointer;border:1px solid transparent;transition:all .18s;',
      'background:var(--bg-subtle,#f1f5f9);color:var(--text-muted,#64748b);}',
    '.hpill:hover,.hpill.active{background:#4a90e2;color:#fff;border-color:#4a90e2;}',
    '.help-sec{margin-bottom:18px;}',
    '.help-sec-hdr{display:flex;align-items:center;gap:8px;font-size:.79rem;',
      'font-weight:700;text-transform:uppercase;letter-spacing:.07em;',
      'padding:8px 0 4px;border-bottom:2px solid;margin-bottom:8px;}',
    '.help-intro{font-size:.79rem;color:var(--text-muted,#64748b);',
      'margin-bottom:10px;line-height:1.6;padding:0 2px;}',
    '.help-qa{margin-bottom:4px;border-radius:10px;overflow:hidden;',
      'border:1px solid var(--border-color,#e5e7eb);}',
    '.help-q{padding:9px 14px;font-size:.81rem;font-weight:600;',
      'cursor:pointer;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;',
      'background:var(--bg-subtle,#f8fafc);color:var(--text,#1e293b);transition:background .15s;',
      'line-height:1.4;}',
    '.help-q:hover{background:rgba(74,144,226,.07);}',
    '.help-q.open{background:rgba(74,144,226,.1);}',
    '.help-chev{font-size:.65rem;color:#94a3b8;transition:transform .2s;flex-shrink:0;margin-top:3px;}',
    '.help-q.open .help-chev{transform:rotate(180deg);}',
    '.help-ans{display:none;padding:11px 14px;font-size:.79rem;line-height:1.7;',
      'color:var(--text-muted,#475569);border-top:1px solid var(--border-color,#e5e7eb);',
      'background:var(--card-bg,#fff);}',
    '.help-ans code{background:rgba(74,144,226,.1);border:1px solid rgba(74,144,226,.2);',
      'border-radius:4px;padding:1px 5px;font-size:.77rem;',
      'color:#1a3a5c;font-family:ui-monospace,monospace;}',
    '[data-theme=dark] .help-ans code{background:rgba(74,144,226,.15);color:#93c5fd;}',
    '.help-ans b{color:var(--text,#1e293b);}',
    '.help-ans span[style]{display:inline;}',
    '.help-empty{text-align:center;padding:3rem 1rem;color:var(--text-muted,#94a3b8);}',
    '.help-empty i{font-size:2.5rem;opacity:.22;display:block;margin-bottom:.5rem;}',
    '.help-ftr{padding:10px 16px;border-top:1px solid var(--border-color,#e5e7eb);',
      'font-size:.72rem;color:var(--text-muted,#94a3b8);flex-shrink:0;',
      'display:flex;align-items:center;justify-content:space-between;}'
  ].join('\n');
  document.head.appendChild(s);
})();

// â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _renderHelp(sectionFilter, query) {
  var el = document.getElementById('helpContentEl');
  if (!el) return;
  var q = (query || '').toLowerCase().trim();
  var sections = sectionFilter === 'all'
    ? HELP_SECTIONS
    : HELP_SECTIONS.filter(function(s) { return s.id === sectionFilter; });

  var html = '';
  var hasAny = false;
  sections.forEach(function(sec) {
    var items = sec.items;
    if (q) {
      items = items.filter(function(it) {
        return it.q.toLowerCase().indexOf(q) >= 0 ||
               it.a.toLowerCase().replace(/<[^>]+>/g,'').indexOf(q) >= 0 ||
               sec.title.toLowerCase().indexOf(q) >= 0;
      });
    }
    if (!items.length) return;
    hasAny = true;
    html += '<div class="help-sec">';
    html += '<div class="help-sec-hdr" style="color:' + sec.color + ';border-color:' + sec.color + '20">' +
            '<i class="fas ' + sec.icon + '"></i>&nbsp;' + sec.title + '</div>';
    if (!q) html += '<div class="help-intro">' + sec.intro + '</div>';
    items.forEach(function(it, i) {
      var uid = 'hq_' + sec.id + '_' + i;
      var qTxt = it.q;
      if (q) {
        var safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        qTxt = qTxt.replace(new RegExp('(' + safe + ')', 'gi'),
          '<mark style="background:#fef08a;border-radius:3px;padding:0 2px">$1</mark>');
      }
      html += '<div class="help-qa">' +
        '<div class="help-q" id="hq_' + uid + '" onclick="helpToggleQA(\'' + uid + '\')">' +
          '<span>' + qTxt + '</span><i class="fas fa-chevron-down help-chev"></i>' +
        '</div>' +
        '<div class="help-ans" id="ha_' + uid + '">' + it.a + '</div>' +
        '</div>';
    });
    html += '</div>';
  });

  if (!hasAny) {
    html = '<div class="help-empty"><i class="fas fa-search"></i>' +
           '<p>No results for &ldquo;' + (query || '') + '&rdquo;</p>' +
           '<p style="font-size:.75rem">Try a different word, or browse by category above.</p></div>';
  }
  el.innerHTML = html;

  // Auto-expand single result
  if (q) {
    var answers = el.querySelectorAll('.help-ans');
    if (answers.length === 1) {
      var qEl = answers[0].previousElementSibling;
      if (qEl) { qEl.classList.add('open'); answers[0].style.display = 'block'; }
    }
  }
}

window.helpToggleQA = function(uid) {
  var q = document.getElementById('hq_' + uid);
  var a = document.getElementById('ha_' + uid);
  if (!q || !a) return;
  var open = q.classList.toggle('open');
  a.style.display = open ? 'block' : 'none';
};

// â”€â”€â”€ Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
document.addEventListener('DOMContentLoaded', function() {
  var themeBtn = document.getElementById('themeToggle');
  if (!themeBtn || document.getElementById('helpBtn')) return;

  // Help button
  var helpBtn = document.createElement('button');
  helpBtn.id = 'helpBtn';
  helpBtn.className = 'btn btn-outline-secondary btn-sm';
  helpBtn.title = 'Help & User Manual';
  helpBtn.style.cssText = 'min-width:36px;';
  helpBtn.innerHTML = '<i class="fas fa-question-circle"></i>';
  themeBtn.parentNode.insertBefore(helpBtn, themeBtn);

  // Backdrop
  var overlay = document.createElement('div');
  overlay.id = 'helpOverlay';
  document.body.appendChild(overlay);

  // Panel
  var panel = document.createElement('div');
  panel.id = 'helpPanel';
  panel.innerHTML =
    '<div class="help-hdr">' +
      '<div style="width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.15);' +
           'display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0;">' +
        '<i class="fas fa-question-circle"></i>' +
      '</div>' +
      '<div class="flex-grow-1">' +
        '<h2>Help &amp; User Manual</h2>' +
        '<p>Home Accounting &mdash; complete feature guide</p>' +
      '</div>' +
      '<button id="helpCloseBtn" style="background:none;border:none;color:rgba(255,255,255,.75);' +
             'font-size:1.2rem;cursor:pointer;padding:4px 8px;border-radius:6px;" aria-label="Close">' +
        '<i class="fas fa-times"></i>' +
      '</button>' +
    '</div>' +
    '<div class="help-srch">' +
      '<input id="helpSearchInput" type="text"' +
             'placeholder="\uD83D\uDD0D  Search topics, features, questions\u2026" autocomplete="off">' +
    '</div>' +
    '<div class="help-body" id="helpBodyEl">' +
      '<div class="help-pills" id="helpPillsEl"></div>' +
      '<div id="helpContentEl"></div>' +
    '</div>' +
    '<div class="help-ftr">' +
      '<span><i class="fas fa-info-circle me-1"></i>Click any question to expand the answer</span>' +
      '<a href="/system-settings?tab=manual" style="color:#4a90e2;text-decoration:none;">' +
        '<i class="fas fa-book me-1"></i>Full Manual' +
      '</a>' +
    '</div>';
  document.body.appendChild(panel);

  // Build pills
  var pillsEl = document.getElementById('helpPillsEl');
  var allPill = document.createElement('button');
  allPill.className = 'hpill active';
  allPill.textContent = '\u2605 All';
  allPill.dataset.section = 'all';
  pillsEl.appendChild(allPill);
  HELP_SECTIONS.forEach(function(s) {
    var b = document.createElement('button');
    b.className = 'hpill';
    b.dataset.section = s.id;
    b.innerHTML = '<i class="fas ' + s.icon + ' me-1"></i>' + s.title;
    pillsEl.appendChild(b);
  });

  var _active = 'all';
  pillsEl.addEventListener('click', function(e) {
    var pill = e.target.closest('.hpill');
    if (!pill) return;
    pillsEl.querySelectorAll('.hpill').forEach(function(p) { p.classList.remove('active'); });
    pill.classList.add('active');
    _active = pill.dataset.section;
    document.getElementById('helpSearchInput').value = '';
    _renderHelp(_active, '');
  });

  var _st;
  document.getElementById('helpSearchInput').addEventListener('input', function() {
    clearTimeout(_st);
    var v = this.value;
    _st = setTimeout(function() { _renderHelp(_active, v); }, 180);
  });

  function openHelp() {
    panel.classList.add('open');
    overlay.classList.add('open');
    _renderHelp('all', '');
    document.getElementById('helpSearchInput').focus();
  }
  function closeHelp() {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  }

  helpBtn.addEventListener('click', function(e) { e.stopPropagation(); openHelp(); });
  overlay.addEventListener('click', closeHelp);
  document.getElementById('helpCloseBtn').addEventListener('click', closeHelp);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeHelp(); });
});

