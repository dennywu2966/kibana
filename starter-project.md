# Project Starter - Quick Start Guide

## Quick Start

Run the project starter script to start the complete stack:

```bash
./project-starter.sh
```

This will:
1. ✅ Start Elasticsearch with HTTPS, Lance Vector, and Cloud IAM plugins
2. ✅ Configure OSS credentials from `~/.oss/credentials.json`
3. ✅ Start Kibana with Aliyun OAuth support
4. ✅ Verify the stack is ready

## Prerequisites

### 1. Build Elasticsearch (if not already built)
```bash
cd ../es-9.2.4-plugins
./gradlew :plugins:lance-vector:assemble :plugins:security-realm-cloud-iam:assemble
./gradlew localDistro
```

### 2. Configure OSS Credentials
Create `~/.oss/credentials.json`:
```json
{
  "access_key_id": "YOUR_KEY",
  "access_key_secret": "YOUR_SECRET",
  "endpoint": "oss-cn-beijing.aliyuncs.com",
  "region": "cn-beijing"
}
```

### 3. ES HTTPS Certificate (already configured)
The ES distribution already has self-signed certificates in:
```
../es-9.2.4-plugins/build/distribution/local/elasticsearch-9.2.4-SNAPSHOT/config/certs/
```

## Stack Configuration

### Elasticsearch
- **Port**: 9200 (HTTPS)
- **Plugins**: lance-vector, security-realm-cloud-iam
- **License**: Trial
- **Credentials**: elastic / Summer11

### Kibana
- **Port**: 5601
- **Public URL**: http://47.236.247.55:5601
- **Memory**: 12GB
- **BasePath**: None (--no-base-path)
- **Parameters**: --inspect --dev

### Access URLs
- **ES**: https://127.0.0.1:9200
- **Kibana**: http://47.236.247.55:5601

## Authentication
1. **Aliyun RAM OAuth** (recommended) - Click "Log in with Aliyun RAM"
2. **Basic Auth** - elastic / Summer11

## Stopping the Stack

```bash
# Stop Elasticsearch
cd ../es-9.2.4-plugins/build/distribution/local/elasticsearch-9.2.4-SNAPSHOT
kill $(cat es.pid)

# Stop Kibana
pkill -f "node.*kibana"
```

## Troubleshooting

### ES won't start?
```bash
tail -50 ../es-9.2.4-plugins/build/distribution/local/elasticsearch-9.2.4-SNAPSHOT/logs/elasticsearch.log
```

### Kibana won't start?
```bash
tail -50 /tmp/kibana_startup.log
```

### Port conflicts?
```bash
# Kill processes on ports 9200 and 5601
fuser -k 9200/tcp
fuser -k 5601/tcp
```

### SSL certificate issues?
The ES distribution includes self-signed certificates. Browsers may show warnings - this is expected for development.

## Configuration Files

### Elasticsearch
- `../es-9.2.4-plugins/build/distribution/local/elasticsearch-9.2.4-SNAPSHOT/config/elasticsearch.yml`
- `../es-9.2.4-plugins/build/distribution/local/elasticsearch-9.2.4-SNAPSHOT/config/jvm.options.d/lance-arrow.options`

### Kibana
- `config/kibana.yml` - Contains ES connection and OAuth configuration

## Manual Start (Advanced)

If you need more control, you can start each service manually:

### Start ES
```bash
cd ../es-9.2.4-plugins/build/distribution/local/elasticsearch-9.2.4-SNAPSHOT
export OSS_ACCESS_KEY_ID="YOUR_KEY"
export OSS_ACCESS_KEY_SECRET="YOUR_SECRET"
export OSS_REGION="cn-beijing"
export OSS_ENDPOINT="oss-cn-beijing.aliyuncs.com"
export OSS_BUCKET="denny-test-lance"
./bin/elasticsearch
```

### Start Kibana
```bash
NODE_OPTIONS="--max-old-space-size=12000" yarn start --inspect --dev --no-base-path
```
