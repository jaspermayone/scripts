var gr = new GlideRecord('incident');
if (gr.get('number', 'INC0010023')) { // Replace with your incident number
    gr.state = 2; // 2 = In Progress
    gr.incident_state = 2;
    gr.work_notes = 'reopened manually by admin_mayonej using background script'; // Internal work note
    gr.setWorkflow(false); // Disables business rules
    gr.autoSysFields(false); // Keeps updated/updated by fields untouched
    gr.update();
}
