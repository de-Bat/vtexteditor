import { exportService } from './src/services/export.service';
import { projectService } from './src/services/project.service';

const projects = projectService.getAll();
if (projects.length === 0) {
  console.log('no projects');
  process.exit(1);
}
const pid = projects[0].id;
const clipIds = projects[0].clips.map(c => c.id);
const jid = exportService.start(pid, 'video', clipIds);
setTimeout(() => {
  console.log(exportService.getJob(jid));
  process.exit(0);
}, 3000);
