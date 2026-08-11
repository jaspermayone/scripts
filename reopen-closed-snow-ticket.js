var gr = new GlideRecord('incident');
if (gr.get('number', 'INC0010023')) { // Replace with your incident number
    gr.state = 2; // 2 = In Progress
    gr.incident_state = 2;
    gr.setWorkflow(false); // Disables business rules
    gr.autoSysFields(false); // Keeps updated/updated by fields untouched
    gr.update();
}
