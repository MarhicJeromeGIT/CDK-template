import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecspatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { S3StaticWebsiteOrigin, LoadBalancerV2Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
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
    const fargateService = new ecspatterns.ApplicationLoadBalancedFargateService(this, 'CounterFargateService', {
      cluster: cluster,
      memoryLimitMiB: 512,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../back'), // Path to your Dockerfile
        containerPort: 8080, // Ensure traffic is directed correctly
      },
      publicLoadBalancer: true,
      healthCheckGracePeriod: cdk.Duration.seconds(60),
      minHealthyPercent: 100,
      maxHealthyPercent: 200
    });

    // Create an S3 bucket for the Vue.js app
    const siteBucket = new s3.Bucket(this, 'CounterSiteBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: true,
      blockPublicAccess: {
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Grant public read access to the bucket
    siteBucket.grantPublicAccess('*', 's3:GetObject');

    // Create a CloudFront distribution for the S3 bucket
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: new S3StaticWebsiteOrigin(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
    });

    // Create an ALB Origin
    const albOrigin = new LoadBalancerV2Origin(fargateService.loadBalancer, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      // protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      customHeaders: {
        'X-Forwarded-For': 'CloudFront', // Optional for debugging
      }
    });

    // Create a CloudFront Origin Request Policy for APIs
    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
    });

    // Add a new behavior for /api to route to the ALB
    distribution.addBehavior('/api/*', albOrigin, {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      originRequestPolicy: apiOriginRequestPolicy,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL, // ✅ Allows GET, POST, PUT, DELETE, etc.
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED, // ✅ Prevents caching issues
    });    

    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: distribution.distributionDomainName,
      description: 'The URL of the CloudFront distribution',
    });

    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the load balancer',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'The ID of the CloudFront distribution',
    });
  }
}
