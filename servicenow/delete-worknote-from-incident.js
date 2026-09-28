var DRY_RUN = true;
var INC_SYS_ID = 'd8198a36938f4b101d25f4974dba10ed';
var MATCH = 'draft reply to mike';

var a = new GlideRecord('sys_audit');
a.addQuery('documentkey', INC_SYS_ID);
a.addQuery('newvalue', 'CONTAINS', MATCH);
a.query();
gs.info('Audit matches: ' + a.getRowCount());
while (a.next()) {
    gs.info('Audit ' + a.getUniqueValue() + ' | fieldname: ' + a.fieldname + ' | tablename: ' + a.tablename + ' | ' + a.sys_created_on);
    if (!DRY_RUN) {
        a.setWorkflow(false);
        var ok = a.deleteRecord();
        gs.info('Audit delete result: ' + ok);
    }
}

if (!DRY_RUN) {
    var h = new GlideRecord('sys_history_set');
    h.addQuery('id', INC_SYS_ID);
    h.query();
    gs.info('History sets deleted: ' + h.getRowCount());
    h.deleteMultiple();
}
