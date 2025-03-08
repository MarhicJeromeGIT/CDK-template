import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecspatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { S3StaticWebsiteOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use an existing VPC
    const vpc = ec2.Vpc.fromLookup(this, 'CounterVpc', {
      vpcName: 'jenkins-vpc'
    });

    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'CounterCluster', {
      vpc: vpc
    });

    // Define the Fargate service
    // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns.ApplicationLoadBalancedFargateService.html
    const fargateService = new ecspatterns.ApplicationLoadBalancedFargateService(this, 'CounterFargateService', {
      cluster: cluster, // Required
      memoryLimitMiB: 512,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../back'), // Path to your Dockerfile
        containerPort: 8080, // 👈 This ensures traffic goes to your container on port 8080
      },
      publicLoadBalancer: true, // Default is false
      healthCheckGracePeriod: cdk.Duration.seconds(60), // Adjust as needed
      minHealthyPercent: 100, // Ensure all tasks are healthy before reducing count
      maxHealthyPercent: 200 // Allow up to double the desired count during deployments
    });

    // Output the ALB DNS name
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the load balancer',
    });

    // Create an S3 bucket for the Vue.js app
    const siteBucket = new s3.Bucket(this, 'CounterSiteBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true, // Allow public access to the bucket
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Automatically delete bucket when stack is deleted
      autoDeleteObjects: true, // Automatically delete objects in the bucket when stack is deleted
    });

    // Grant public read access to the bucket
    siteBucket.grantPublicAccess('*', 's3:GetObject');
   
    // TODO
    // siteBucket.grantRead(new iam.AnyPrincipal());

    // Create a CloudFront distribution for the S3 bucket
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: new S3StaticWebsiteOrigin(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    // Output the CloudFront distribution domain name
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: distribution.distributionDomainName,
      description: 'The URL of the CloudFront distribution',
    });

    // Output the CloudFront distribution ID
    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'The ID of the CloudFront distribution',
    });
  }
}
