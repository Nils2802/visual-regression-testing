import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
  const [name, baseUrl] = process.argv.slice(2);
  if (!name || !baseUrl) {
    console.error('usage: npx tsx scripts/seed.ts <name> <baseUrl>');
    process.exit(1);
  }
  const project = await prisma.project.create({ data: { name } });
  await prisma.environment.create({ data: { projectId: project.id, name: 'default', baseUrl } });
  const viewports = await Promise.all([
    prisma.viewport.create({ data: { projectId: project.id, name: 'mobile', width: 375, height: 812 } }),
    prisma.viewport.create({ data: { projectId: project.id, name: 'desktop', width: 1440, height: 900 } }),
  ]);
  const baseline = await prisma.baseline.create({
    data: { projectId: project.id, name: 'home', pagePath: '/', sourceType: 'capture' },
  });
  for (const vp of viewports) {
    await prisma.baselineTarget.create({ data: { baselineId: baseline.id, viewportId: vp.id } });
  }
  console.log(`project ${project.id} seeded (2 viewports, baseline "home" → /)`);
}

main().finally(() => prisma.$disconnect());
