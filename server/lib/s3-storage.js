/**
 * s3-storage — S3-backed implementation of the tenant storage
 * interface. Lazy-loaded by storage.js when config.driver === 's3'
 * so the local-driver default doesn't pull @aws-sdk into the
 * bundle.
 *
 * Why a separate file:
 *   - ANT's sovereignty rule is "outbound OFF by default". The
 *     S3 driver is opt-in. If the S3 SDK isn't installed and
 *     the user never asks for the s3 driver, we don't pay the
 *     dependency cost.
 *
 *   - The AWS SDK loads ~6MB of node_modules. Putting it in its
 *     own file means a `require('node:fs')` only path stays light.
 *
 * To enable: npm install @aws-sdk/client-s3, then
 *   createStorage({ driver: 's3', bucket, endpoint, region, ... })
 *
 * Contract matches server/lib/storage.js. S3 path:
 *   putObject -> PutObjectCommand
 *   getObject -> GetObjectCommand (returns Node stream; ENOENT
 *     is normalized to null, NOT thrown)
 *   deleteObject -> DeleteObjectCommand
 *   listObjects -> ListObjectsV2Command (paginated)
 *   syncPrefixToDir -> stream copy
 *   syncDirToPrefix -> single PutObject per file (no multipart;
 *     OK up to ~1GB per file)
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const {
  normalizeSlug,
  normalizeProduct,
  normalizeObjectName,
  tenantObjectKey,
  serializeBody
} = require('./storage');

function requireS3Sdk() {
  try {
    // eslint-disable-next-line global-require
    return require('@aws-sdk/client-s3');
  } catch (err) {
    throw new Error(
      'S3 storage driver requires the @aws-sdk/client-s3 package. ' +
        'Run `npm install @aws-sdk/client-s3` to enable the s3 driver. ' +
        'Default to the local driver by setting `driver: "local"` in your storage config.'
    );
  }
}

function createS3Storage(config, audit) {
  // Validate config BEFORE requiring the SDK. Callers with
  // misconfigured S3 (missing bucket/region) get a clean
  // error message without the SDK ever being loaded.
  if (!config.bucket) throw new Error('S3 storage requires config.bucket');
  if (!config.region) throw new Error('S3 storage requires config.region');
  const auditEvent = audit || (() => {});

  // Defer client + commands to first method call. If a user
  // creates an S3 storage but never invokes a method, the SDK
  // is never required.
  let cachedSdk;
  function sdk() {
    if (!cachedSdk) cachedSdk = requireS3Sdk();
    return cachedSdk;
  }

  return {
    driver: 's3',

    async putObject(tenantSlug, productCode, key, body) {
      const { PutObjectCommand } = sdk();
      const objectKey = tenantObjectKey(tenantSlug, productCode, key);
      const { payload, bytes } = serializeBody(body);
      await this._client().send(
        new PutObjectCommand({ Bucket: config.bucket, Key: objectKey, Body: payload })
      );
      auditEvent({
        type: 'storage.put',
        tenantSlug: normalizeSlug(tenantSlug),
        productCode: normalizeProduct(productCode),
        key: normalizeObjectName(key),
        bytes
      });
      return { key: objectKey };
    },

    async getObject(tenantSlug, productCode, key) {
      const { GetObjectCommand } = sdk();
      const objectKey = tenantObjectKey(tenantSlug, productCode, key);
      try {
        const result = await this._client().send(
          new GetObjectCommand({ Bucket: config.bucket, Key: objectKey })
        );
        const chunks = [];
        for await (const chunk of result.Body) chunks.push(chunk);
        return Buffer.concat(chunks);
      } catch (err) {
        // Normalize S3 404 to null so the caller pattern matches
        // the local driver (which returns null for missing files).
        if (err && (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)) {
          return null;
        }
        throw err;
      }
    },

    async deleteObject(tenantSlug, productCode, key) {
      const { DeleteObjectCommand } = sdk();
      const objectKey = tenantObjectKey(tenantSlug, productCode, key);
      await this._client().send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey })
      );
      auditEvent({
        type: 'storage.delete',
        tenantSlug: normalizeSlug(tenantSlug),
        productCode: normalizeProduct(productCode),
        key: normalizeObjectName(key)
      });
    },

    async listObjects(tenantSlug, productCode) {
      const { ListObjectsV2Command } = sdk();
      const slug = normalizeSlug(tenantSlug);
      const prefix = productCode
        ? `tenants/${slug}/${normalizeProduct(productCode)}/`
        : `tenants/${slug}/`;
      const keys = [];
      let ContinuationToken;
      do {
        const result = await this._client().send(
          new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix,
            ContinuationToken
          })
        );
        for (const item of result.Contents || []) keys.push(item.Key);
        ContinuationToken = result.NextContinuationToken;
      } while (ContinuationToken);
      return keys.sort();
    },

    async countTenantObjects(tenantSlug) {
      return (await this.listObjects(tenantSlug)).length;
    },

    async syncPrefixToDir(tenantSlug, targetDir) {
      const { GetObjectCommand } = sdk();
      const slug = normalizeSlug(tenantSlug);
      await fsp.mkdir(targetDir, { recursive: true });
      const keys = await this.listObjects(tenantSlug);
      for (const key of keys) {
        const relative = key.replace(`tenants/${slug}/`, '');
        const target = path.join(targetDir, relative);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const result = await this._client().send(
          new GetObjectCommand({ Bucket: config.bucket, Key: key })
        );
        await pipeline(result.Body, fs.createWriteStream(target));
      }
      auditEvent({ type: 'storage.sync.out', tenantSlug: slug, count: keys.length });
      return keys.length;
    },

    async syncDirToPrefix(tenantSlug, sourceDir) {
      const { PutObjectCommand } = sdk();
      const slug = normalizeSlug(tenantSlug);
      let count = 0;
      async function walk(dir, files) {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) await walk(full, files);
          else if (entry.isFile()) files.push(full);
        }
        return files;
      }
      if (!fs.existsSync(sourceDir)) return 0;
      for (const file of await walk(sourceDir, [])) {
        const relative = path.relative(sourceDir, file).split(path.sep).join('/');
        const key = `tenants/${slug}/${normalizeObjectName(relative)}`;
        await this._client().send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: key,
            Body: fs.createReadStream(file)
          })
        );
        count += 1;
      }
      auditEvent({ type: 'storage.sync.in', tenantSlug: slug, count });
      return count;
    },

    // Private: lazy-construct the S3 client on first use. Exposed
    // via the duck-typed surface so the public methods above can
    // share the connection.
    _client() {
      if (!this.__client) {
        const { S3Client } = sdk();
        this.__client = new S3Client({
          endpoint: config.endpoint,
          region: config.region,
          forcePathStyle: config.forcePathStyle !== false,
          credentials: config.accessKeyId
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
              }
            : undefined
        });
      }
      return this.__client;
    }
  };
}

module.exports = { createS3Storage };
