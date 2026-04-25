import { describe, it, beforeEach, afterEach, before as beforeAll, after as afterAll, mock } from 'node:test';
import assert from 'node:assert';

const mockSend = mock.fn();

vi.mock('@aws-sdk/client-rds', async () => {
  const actual = await vi.importActual('@aws-sdk/client-rds');
  return {
    ...actual,
    RDSClient: mock.fn().mockImplementation(() => ({ send: mockSend })),
  };
});

vi.mock('../../../src/utils/logger.ts', () => {
  const childLogger = {
    debug: mock.fn(),
    info: mock.fn(),
    warn: mock.fn(),
    error: mock.fn(),
    child: mock.fn().mockReturnThis(),
  };
  return {
    getLogger: () => ({
      child: () => childLogger,
      debug: mock.fn(),
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
    }),
  };
});

import { RDSProvider } from '../../../src/provisioning/providers/rds-provider.ts';

describe('RDSProvider', () => {
  let provider: RDSProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RDSProvider();
  });

  // ─── DBSubnetGroup ────────────────────────────────────────────────

  describe('DBSubnetGroup', () => {
    describe('create', () => {
      it('should create a DBSubnetGroup and return subnet group name as physicalId', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await provider.create('MySubnetGroup', 'AWS::RDS::DBSubnetGroup', {
          DBSubnetGroupName: 'my-subnet-group',
          DBSubnetGroupDescription: 'Test subnet group',
          SubnetIds: ['subnet-aaa', 'subnet-bbb'],
        });

        assert.strictEqual(result.physicalId, 'my-subnet-group');
        expect(result.attributes).toEqual({
          DBSubnetGroupName: 'my-subnet-group',
        });
        expect(mockSend).toHaveBeenCalledTimes(1);

        const createCall = mockSend.mock.calls[0][0];
        assert.strictEqual(createCall.constructor.name, 'CreateDBSubnetGroupCommand');
        assert.strictEqual(createCall.input.DBSubnetGroupName, 'my-subnet-group');
        assert.deepStrictEqual(createCall.input.SubnetIds, ['subnet-aaa', 'subnet-bbb']);
      });

      it('should use logicalId as name when DBSubnetGroupName is not provided', async () => {
        mockSend.mockResolvedValueOnce({});

        const result = await provider.create('MySubnetGroup', 'AWS::RDS::DBSubnetGroup', {
          DBSubnetGroupDescription: 'Test subnet group',
          SubnetIds: ['subnet-aaa'],
        });

        assert.strictEqual(result.physicalId, 'mysubnetgroup');

        const createCall = mockSend.mock.calls[0][0];
        assert.strictEqual(createCall.input.DBSubnetGroupName, 'mysubnetgroup');
      });

      it('should throw ProvisioningError on failure', async () => {
        mockSend.mockRejectedValueOnce(new Error('Access Denied'));

        await expect(
          provider.create('MySubnetGroup', 'AWS::RDS::DBSubnetGroup', {
            SubnetIds: ['subnet-aaa'],
          })
        ).rejects.toThrow('Failed to create DBSubnetGroup MySubnetGroup');
      });
    });

    describe('delete', () => {
      it('should delete a DBSubnetGroup', async () => {
        mockSend.mockResolvedValueOnce({});

        await provider.delete('MySubnetGroup', 'my-subnet-group', 'AWS::RDS::DBSubnetGroup');

        expect(mockSend).toHaveBeenCalledTimes(1);

        const deleteCall = mockSend.mock.calls[0][0];
        assert.strictEqual(deleteCall.constructor.name, 'DeleteDBSubnetGroupCommand');
        assert.strictEqual(deleteCall.input.DBSubnetGroupName, 'my-subnet-group');
      });

      it('should handle DBSubnetGroupNotFoundFault gracefully', async () => {
        const notFoundError = new Error('DBSubnetGroup not found');
        (notFoundError as { name: string }).name = 'DBSubnetGroupNotFoundFault';
        mockSend.mockRejectedValueOnce(notFoundError);

        await provider.delete('MySubnetGroup', 'my-subnet-group', 'AWS::RDS::DBSubnetGroup');

        expect(mockSend).toHaveBeenCalledTimes(1);
      });

      it('should throw ProvisioningError on unexpected failure', async () => {
        mockSend.mockRejectedValueOnce(new Error('Access Denied'));

        await expect(
          provider.delete('MySubnetGroup', 'my-subnet-group', 'AWS::RDS::DBSubnetGroup')
        ).rejects.toThrow('Failed to delete DBSubnetGroup MySubnetGroup');
      });
    });
  });

  // ─── DBCluster ────────────────────────────────────────────────────

  describe('DBCluster', () => {
    describe('create', () => {
      it('should create a DBCluster and return identifier with attributes', async () => {
        // CreateDBClusterCommand
        mockSend.mockResolvedValueOnce({
          DBCluster: {
            DBClusterIdentifier: 'my-cluster',
            DBClusterArn: 'arn:aws:rds:us-east-1:123456789012:cluster:my-cluster',
          },
        });
        // DescribeDBClusters (waitForClusterAvailable)
        mockSend.mockResolvedValueOnce({
          DBClusters: [
            {
              DBClusterIdentifier: 'my-cluster',
              Status: 'available',
              Endpoint: 'my-cluster.cluster-xxx.us-east-1.rds.amazonaws.com',
              Port: 5432,
              ReaderEndpoint: 'my-cluster.cluster-ro-xxx.us-east-1.rds.amazonaws.com',
              DBClusterArn: 'arn:aws:rds:us-east-1:123456789012:cluster:my-cluster',
              DbClusterResourceId: 'cluster-ABCDEF123456',
            },
          ],
        });
        // DescribeDBClusters (final describe for attributes)
        mockSend.mockResolvedValueOnce({
          DBClusters: [
            {
              DBClusterIdentifier: 'my-cluster',
              Status: 'available',
              Endpoint: 'my-cluster.cluster-xxx.us-east-1.rds.amazonaws.com',
              Port: 5432,
              ReaderEndpoint: 'my-cluster.cluster-ro-xxx.us-east-1.rds.amazonaws.com',
              DBClusterArn: 'arn:aws:rds:us-east-1:123456789012:cluster:my-cluster',
              DbClusterResourceId: 'cluster-ABCDEF123456',
            },
          ],
        });

        const result = await provider.create('MyCluster', 'AWS::RDS::DBCluster', {
          DBClusterIdentifier: 'my-cluster',
          Engine: 'aurora-postgresql',
          MasterUsername: 'admin',
          MasterUserPassword: 'secret123',
        });

        assert.strictEqual(result.physicalId, 'my-cluster');
        expect(result.attributes).toEqual({
          'Endpoint.Address': 'my-cluster.cluster-xxx.us-east-1.rds.amazonaws.com',
          'Endpoint.Port': '5432',
          'ReadEndpoint.Address': 'my-cluster.cluster-ro-xxx.us-east-1.rds.amazonaws.com',
          Arn: 'arn:aws:rds:us-east-1:123456789012:cluster:my-cluster',
          DBClusterResourceId: 'cluster-ABCDEF123456',
        });

        const createCall = mockSend.mock.calls[0][0];
        assert.strictEqual(createCall.constructor.name, 'CreateDBClusterCommand');
        assert.strictEqual(createCall.input.Engine, 'aurora-postgresql');
      });

      it('should use lowercased logicalId when DBClusterIdentifier is not provided', async () => {
        mockSend.mockResolvedValueOnce({
          DBCluster: { DBClusterIdentifier: 'mycluster' },
        });
        // waitForClusterAvailable
        mockSend.mockResolvedValueOnce({
          DBClusters: [{ Status: 'available' }],
        });
        // final describe
        mockSend.mockResolvedValueOnce({
          DBClusters: [{}],
        });

        const result = await provider.create('MyCluster', 'AWS::RDS::DBCluster', {
          Engine: 'aurora-postgresql',
        });

        assert.strictEqual(result.physicalId, 'mycluster');

        const createCall = mockSend.mock.calls[0][0];
        assert.strictEqual(createCall.input.DBClusterIdentifier, 'mycluster');
      });

      it('should throw ProvisioningError on failure', async () => {
        mockSend.mockRejectedValueOnce(new Error('Access Denied'));

        await expect(
          provider.create('MyCluster', 'AWS::RDS::DBCluster', {
            Engine: 'aurora-postgresql',
          })
        ).rejects.toThrow('Failed to create DBCluster MyCluster');
      });
    });

    describe('delete', () => {
      it('should disable deletion protection and delete with SkipFinalSnapshot=true', async () => {
        // ModifyDBClusterCommand (disable deletion protection)
        mockSend.mockResolvedValueOnce({});
        // DeleteDBClusterCommand
        mockSend.mockResolvedValueOnce({});
        // DescribeDBClusters (waitForClusterDeleted) - not found
        const notFoundError = new Error('DBCluster not found');
        (notFoundError as { name: string }).name = 'DBClusterNotFoundFault';
        mockSend.mockRejectedValueOnce(notFoundError);

        await provider.delete('MyCluster', 'my-cluster', 'AWS::RDS::DBCluster');

        expect(mockSend).toHaveBeenCalledTimes(3);

        const modifyCall = mockSend.mock.calls[0][0];
        assert.strictEqual(modifyCall.constructor.name, 'ModifyDBClusterCommand');
        assert.strictEqual(modifyCall.input.DeletionProtection, false);

        const deleteCall = mockSend.mock.calls[1][0];
        assert.strictEqual(deleteCall.constructor.name, 'DeleteDBClusterCommand');
        assert.strictEqual(deleteCall.input.DBClusterIdentifier, 'my-cluster');
        assert.strictEqual(deleteCall.input.SkipFinalSnapshot, true);
      });

      it('should handle DBClusterNotFoundFault gracefully', async () => {
        // ModifyDBClusterCommand (disable deletion protection) - not found
        const notFoundError1 = new Error('DBCluster not found');
        (notFoundError1 as { name: string }).name = 'DBClusterNotFoundFault';
        mockSend.mockRejectedValueOnce(notFoundError1);

        // DeleteDBClusterCommand - not found
        const notFoundError2 = new Error('DBCluster not found');
        (notFoundError2 as { name: string }).name = 'DBClusterNotFoundFault';
        mockSend.mockRejectedValueOnce(notFoundError2);

        await provider.delete('MyCluster', 'my-cluster', 'AWS::RDS::DBCluster');

        expect(mockSend).toHaveBeenCalledTimes(2);
      });

      it('should throw ProvisioningError on unexpected failure', async () => {
        // ModifyDBClusterCommand succeeds
        mockSend.mockResolvedValueOnce({});
        // DeleteDBClusterCommand fails
        mockSend.mockRejectedValueOnce(new Error('Access Denied'));

        await expect(
          provider.delete('MyCluster', 'my-cluster', 'AWS::RDS::DBCluster')
        ).rejects.toThrow('Failed to delete DBCluster MyCluster');
      });
    });
  });

  // ─── DBInstance ───────────────────────────────────────────────────

  describe('DBInstance', () => {
    describe('create', () => {
      it('should create a DBInstance and return identifier with attributes', async () => {
        // CreateDBInstanceCommand
        mockSend.mockResolvedValueOnce({
          DBInstance: {
            DBInstanceIdentifier: 'my-instance',
            DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-instance',
          },
        });
        // DescribeDBInstances (waitForInstanceAvailable)
        mockSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'my-instance',
              DBInstanceStatus: 'available',
              Endpoint: {
                Address: 'my-instance.xxx.us-east-1.rds.amazonaws.com',
                Port: 5432,
              },
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-instance',
            },
          ],
        });
        // DescribeDBInstances (final describe for attributes)
        mockSend.mockResolvedValueOnce({
          DBInstances: [
            {
              DBInstanceIdentifier: 'my-instance',
              DBInstanceStatus: 'available',
              Endpoint: {
                Address: 'my-instance.xxx.us-east-1.rds.amazonaws.com',
                Port: 5432,
              },
              DBInstanceArn: 'arn:aws:rds:us-east-1:123456789012:db:my-instance',
            },
          ],
        });

        const result = await provider.create('MyInstance', 'AWS::RDS::DBInstance', {
          DBInstanceIdentifier: 'my-instance',
          DBInstanceClass: 'db.serverless',
          Engine: 'aurora-postgresql',
          DBClusterIdentifier: 'my-cluster',
        });

        assert.strictEqual(result.physicalId, 'my-instance');
        expect(result.attributes).toEqual({
          'Endpoint.Address': 'my-instance.xxx.us-east-1.rds.amazonaws.com',
          'Endpoint.Port': '5432',
          Arn: 'arn:aws:rds:us-east-1:123456789012:db:my-instance',
        });

        const createCall = mockSend.mock.calls[0][0];
        assert.strictEqual(createCall.constructor.name, 'CreateDBInstanceCommand');
        assert.strictEqual(createCall.input.DBInstanceClass, 'db.serverless');
        assert.strictEqual(createCall.input.Engine, 'aurora-postgresql');
        assert.strictEqual(createCall.input.DBClusterIdentifier, 'my-cluster');
      });

      it('should use lowercased logicalId when DBInstanceIdentifier is not provided', async () => {
        mockSend.mockResolvedValueOnce({
          DBInstance: { DBInstanceIdentifier: 'myinstance' },
        });
        // waitForInstanceAvailable
        mockSend.mockResolvedValueOnce({
          DBInstances: [{ DBInstanceStatus: 'available' }],
        });
        // final describe
        mockSend.mockResolvedValueOnce({
          DBInstances: [{}],
        });

        const result = await provider.create('MyInstance', 'AWS::RDS::DBInstance', {
          DBInstanceClass: 'db.serverless',
          Engine: 'aurora-postgresql',
        });

        assert.strictEqual(result.physicalId, 'myinstance');

        const createCall = mockSend.mock.calls[0][0];
        assert.strictEqual(createCall.input.DBInstanceIdentifier, 'myinstance');
      });

      it('should throw ProvisioningError on failure', async () => {
        mockSend.mockRejectedValueOnce(new Error('Access Denied'));

        await expect(
          provider.create('MyInstance', 'AWS::RDS::DBInstance', {
            DBInstanceClass: 'db.serverless',
            Engine: 'aurora-postgresql',
          })
        ).rejects.toThrow('Failed to create DBInstance MyInstance');
      });
    });

    describe('delete', () => {
      it('should disable deletion protection and delete with SkipFinalSnapshot=true', async () => {
        // ModifyDBInstanceCommand (disable deletion protection)
        mockSend.mockResolvedValueOnce({});
        // DeleteDBInstanceCommand
        mockSend.mockResolvedValueOnce({});
        // DescribeDBInstances (waitForInstanceDeleted) - not found
        const notFoundError = new Error('DBInstance not found');
        (notFoundError as { name: string }).name = 'DBInstanceNotFoundFault';
        mockSend.mockRejectedValueOnce(notFoundError);

        await provider.delete('MyInstance', 'my-instance', 'AWS::RDS::DBInstance');

        expect(mockSend).toHaveBeenCalledTimes(3);

        const modifyCall = mockSend.mock.calls[0][0];
        assert.strictEqual(modifyCall.constructor.name, 'ModifyDBInstanceCommand');
        assert.strictEqual(modifyCall.input.DeletionProtection, false);
        assert.strictEqual(modifyCall.input.ApplyImmediately, true);

        const deleteCall = mockSend.mock.calls[1][0];
        assert.strictEqual(deleteCall.constructor.name, 'DeleteDBInstanceCommand');
        assert.strictEqual(deleteCall.input.DBInstanceIdentifier, 'my-instance');
        assert.strictEqual(deleteCall.input.SkipFinalSnapshot, true);
      });

      it('should handle DBInstanceNotFoundFault gracefully', async () => {
        // ModifyDBInstanceCommand (disable deletion protection) - not found
        const notFoundError1 = new Error('DBInstance not found');
        (notFoundError1 as { name: string }).name = 'DBInstanceNotFoundFault';
        mockSend.mockRejectedValueOnce(notFoundError1);

        // DeleteDBInstanceCommand - not found
        const notFoundError2 = new Error('DBInstance not found');
        (notFoundError2 as { name: string }).name = 'DBInstanceNotFoundFault';
        mockSend.mockRejectedValueOnce(notFoundError2);

        await provider.delete('MyInstance', 'my-instance', 'AWS::RDS::DBInstance');

        expect(mockSend).toHaveBeenCalledTimes(2);
      });

      it('should throw ProvisioningError on unexpected failure', async () => {
        // ModifyDBInstanceCommand succeeds
        mockSend.mockResolvedValueOnce({});
        // DeleteDBInstanceCommand fails
        mockSend.mockRejectedValueOnce(new Error('Access Denied'));

        await expect(
          provider.delete('MyInstance', 'my-instance', 'AWS::RDS::DBInstance')
        ).rejects.toThrow('Failed to delete DBInstance MyInstance');
      });
    });
  });

  // ─── Unsupported resource type ────────────────────────────────────

  describe('unsupported resource type', () => {
    it('should throw ProvisioningError for unsupported resource type on create', async () => {
      await expect(
        provider.create('MyResource', 'AWS::RDS::Unknown', {})
      ).rejects.toThrow('Unsupported resource type: AWS::RDS::Unknown');
    });

    it('should throw ProvisioningError for unsupported resource type on delete', async () => {
      await expect(
        provider.delete('MyResource', 'some-id', 'AWS::RDS::Unknown')
      ).rejects.toThrow('Unsupported resource type: AWS::RDS::Unknown');
    });
  });
});
