#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function readPackageJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`❌ Error reading ${filePath}:`, error.message);
    return null;
  }
}

function writeVersionManifest(manifest, outputPath) {
  try {
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2));
    console.log(`✅ Version manifest written to ${outputPath}`);
  } catch (error) {
    console.error(`❌ Error writing manifest:`, error.message);
    process.exit(1);
  }
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const componentsDir = path.join(rootDir, 'components');
  const terraformDir = path.join(rootDir, 'terraform');
  
  // Lire la version globale
  const rootPackage = readPackageJson(path.join(rootDir, 'package.json'));
  if (!rootPackage) {
    console.error('❌ Cannot read root package.json');
    process.exit(1);
  }
  
  const globalVersion = rootPackage.version;
  console.log(`📦 Global version: v${globalVersion}`);
  
  // Détecter et lire les composants
  const componentVersions = {};
  const componentPaths = {};
  
  if (fs.existsSync(componentsDir)) {
    const components = fs.readdirSync(componentsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const component of components) {
      const componentPackagePath = path.join(componentsDir, component, 'package.json');
      const componentPackage = readPackageJson(componentPackagePath);
      
      if (componentPackage && componentPackage.version) {
        componentVersions[component] = componentPackage.version;
        componentPaths[component] = path.join('components', component);
        console.log(`   └─ ${component}: v${componentPackage.version}`);
      } else {
        console.warn(`⚠️  Component ${component} has no package.json or version`);
      }
    }
  }
  
  // Créer le manifeste de versions
  const versionManifest = {
    global: globalVersion,
    timestamp: new Date().toISOString(),
    git: {
      sha: process.env.GITHUB_SHA || process.env.GIT_SHA || 'local',
      ref: process.env.GITHUB_REF || process.env.GIT_REF || 'local',
      actor: process.env.GITHUB_ACTOR || process.env.GIT_ACTOR || 'local'
    },
    environment: {
      node_version: process.version,
      npm_version: process.env.npm_version || 'unknown',
      platform: process.platform,
      arch: process.arch
    },
    components: componentVersions,
    paths: componentPaths
  };
  
  // Écrire le manifeste pour Terraform
  const terraformManifestPath = path.join(terraformDir, 'versions.json');
  writeVersionManifest(versionManifest, terraformManifestPath);
  
  // Écrire un manifeste simplifié pour les workflows
  const workflowManifest = {
    global: globalVersion,
    components: componentVersions
  };
  
  const workflowManifestPath = path.join(rootDir, '.github', 'versions.json');
  if (fs.existsSync(path.join(rootDir, '.github'))) {
    writeVersionManifest(workflowManifest, workflowManifestPath);
  }
  
  console.log('🎉 Version synchronization completed successfully!');
  
  // Retourner le manifeste pour utilisation programmatique
  return versionManifest;
}

// Exécuter si appelé directement
if (require.main === module) {
  main();
}

module.exports = { main };